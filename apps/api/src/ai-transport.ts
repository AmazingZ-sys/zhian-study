import { lookup as resolveAddress } from 'node:dns';
import { request as requestHttp, type IncomingMessage } from 'node:http';
import { request as requestHttps } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

const maxReplyBytes = 256 * 1024;

const privateIpv4 = new BlockList();
privateIpv4.addSubnet('10.0.0.0', 8);
privateIpv4.addSubnet('100.64.0.0', 10);
privateIpv4.addSubnet('127.0.0.0', 8);
privateIpv4.addSubnet('172.16.0.0', 12);
privateIpv4.addSubnet('192.168.0.0', 16);

// https://www.iana.org/assignments/iana-ipv4-special-registry/
const reservedIpv4 = new BlockList();
reservedIpv4.addSubnet('0.0.0.0', 8);
reservedIpv4.addSubnet('169.254.0.0', 16);
reservedIpv4.addSubnet('192.0.0.0', 24);
reservedIpv4.addSubnet('192.0.2.0', 24);
reservedIpv4.addSubnet('192.88.99.0', 24);
reservedIpv4.addSubnet('198.18.0.0', 15);
reservedIpv4.addSubnet('198.51.100.0', 24);
reservedIpv4.addSubnet('203.0.113.0', 24);
reservedIpv4.addSubnet('224.0.0.0', 3);

const privateIpv6 = new BlockList();
privateIpv6.addAddress('::1', 'ipv6');
privateIpv6.addSubnet('fc00::', 7, 'ipv6');

const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
// Special-purpose blocks within global unicast, including Teredo and 6to4.
// https://www.iana.org/assignments/iana-ipv6-special-registry/
const reservedIpv6 = new BlockList();
reservedIpv6.addSubnet('2001::', 23, 'ipv6');
reservedIpv6.addSubnet('2001:db8::', 32, 'ipv6');
reservedIpv6.addSubnet('2002::', 16, 'ipv6');
reservedIpv6.addSubnet('3ffe::', 16, 'ipv6');
reservedIpv6.addSubnet('3fff::', 20, 'ipv6');

const loopbackIpv4 = new BlockList();
loopbackIpv4.addSubnet('127.0.0.0', 8);
const loopbackIpv6 = new BlockList();
loopbackIpv6.addAddress('::1', 'ipv6');

function isPrivateOrigin(url: URL) {
  if (url.protocol !== 'https:') return false;
  return (process.env.AI_PRIVATE_GATEWAY_ORIGINS ?? '').split(',').some((entry) => {
    try {
      return new URL(entry.trim()).href === `${url.origin}/`;
    } catch {
      return false;
    }
  });
}

async function readReply(response: IncomingMessage): Promise<unknown> {
  if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
    response.destroy();
    throw new Error('invalid gateway status');
  }
  if (Number(response.headers['content-length']) > maxReplyBytes) {
    response.destroy();
    throw new Error('gateway response is too large');
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > maxReplyBytes) throw new Error('gateway response is too large');
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
}

export async function postGateway(
  value: string,
  headers: Record<string, string>,
  payload: string,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const secure = url.protocol === 'https:';
  const useLoopback =
    process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(hostname);
  const allowPrivate = isPrivateOrigin(url);
  if ((!secure && (url.protocol !== 'http:' || !useLoopback)) || url.username || url.password) {
    throw new Error('invalid gateway URL');
  }

  function allows(address: string, family: number) {
    if (![4, 6].includes(family) || isIP(address) !== family || address.includes('%')) return false;
    if (useLoopback) return family === 4 ? loopbackIpv4.check(address) : loopbackIpv6.check(address, 'ipv6');

    if (family === 4) {
      if (privateIpv4.check(address)) return allowPrivate;
      return !reservedIpv4.check(address);
    }
    if (privateIpv6.check(address, 'ipv6')) return allowPrivate;
    return globalIpv6.check(address, 'ipv6') && !reservedIpv6.check(address, 'ipv6');
  }

  // Node bypasses lookup when the URL already contains an IP address.
  const ipFamily = isIP(hostname);
  if (ipFamily && !allows(hostname, ipFamily)) throw new Error('gateway address blocked');

  const lookup: LookupFunction = (name, options, callback) => {
    resolveAddress(name, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, '');
      const allowed = addresses.filter(({ address, family }) => allows(address, family));
      const first = allowed[0];
      if (!first) return callback(new Error('gateway addresses blocked'), '');
      if (options.all) return callback(null, allowed);
      return callback(null, first.address, first.family);
    });
  };

  const outgoing = new Headers(headers);
  outgoing.set('host', url.host);
  outgoing.set('content-length', String(Buffer.byteLength(payload)));
  outgoing.set('accept-encoding', 'identity');
  outgoing.delete('transfer-encoding');

  return new Promise((resolve, reject) => {
    const request = secure ? requestHttps : requestHttp;
    const connection = request(
      url,
      {
        method: 'POST',
        headers: Object.fromEntries(outgoing),
        // Use a fresh socket so all DNS results are checked for this request.
        agent: false,
        lookup,
        signal,
        ...(secure && { rejectUnauthorized: true, ...(ipFamily ? {} : { servername: hostname }) }),
      },
      (response) => void readReply(response).then(resolve, reject),
    );
    connection.on('error', reject);
    connection.end(payload);
  });
}
