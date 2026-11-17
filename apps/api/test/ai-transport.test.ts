import type { LookupAddress, LookupAllOptions } from 'node:dns';
import { createServer } from 'node:http';
import { getDefaultAutoSelectFamily, setDefaultAutoSelectFamily, type AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { postGateway } from '../src/ai-transport.js';

const { lookup } = vi.hoisted(() => ({
  lookup:
    vi.fn<
      (
        name: string,
        options: LookupAllOptions,
        callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
      ) => void
    >(),
}));
vi.mock('node:dns', () => ({ lookup }));

const server = createServer((request, response) => {
  request.resume();
  if (request.url === '/redirect') {
    response.writeHead(307, { Location: '/target' }).end();
  } else if (request.url === '/overflow') {
    response.write(Buffer.alloc(256 * 1024));
    response.end('extra bytes');
  } else {
    response.end(JSON.stringify({ host: request.headers.host, size: request.headers['content-length'] }));
  }
});

let port: number;
const signal = () => AbortSignal.timeout(1500);

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});
afterEach(() => {
  vi.unstubAllEnvs();
  lookup.mockReset();
});

describe('AI 网关传输', () => {
  it.each([true, false])('只连接过滤后的 localhost 地址（自动选择地址族 %s）', async (autoSelect) => {
    vi.stubEnv('NODE_ENV', 'test');
    lookup.mockImplementation((_name, _options, callback) =>
      callback(null, [
        { address: '192.0.2.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    );
    const previous = getDefaultAutoSelectFamily();
    setDefaultAutoSelectFamily(autoSelect);
    try {
      const result = await postGateway(
        `http://localhost:${port}/target`,
        { Host: 'wrong.test' },
        '中',
        signal(),
      );
      expect(result).toEqual({ host: `localhost:${port}`, size: '3' });
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(lookup.mock.calls[0]?.[1].all).toBe(true);
    } finally {
      setDefaultAutoSelectFamily(previous);
    }
  });

  it.each(['127.0.0.1', '0x7f000001', '[::1]', '[::ffff:7f00:1]', '[2002:7f00:1::]'])(
    '拦截生产网关中的特殊字面地址 %s',
    async (host) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('AI_PRIVATE_GATEWAY_ORIGINS', '');
      await expect(postGateway(`https://${host}:${port}/target`, {}, '', signal())).rejects.toThrow(
        'gateway address blocked',
      );
    },
  );

  it('禁止私有 DNS 应答与未精确匹配的 HTTPS origin', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AI_PRIVATE_GATEWAY_ORIGINS', `https://other.test:${port},https://gateway.test:1`);
    lookup.mockImplementation((_name, _options, callback) =>
      callback(null, [
        { address: '127.0.0.1', family: 4 },
        { address: '::ffff:127.0.0.1', family: 6 },
      ]),
    );
    await expect(postGateway(`https://gateway.test:${port}/target`, {}, '', signal())).rejects.toThrow(
      'gateway addresses blocked',
    );
  });

  it('禁止跳转和超出限制的分块响应', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    await expect(postGateway(`http://127.0.0.1:${port}/redirect`, {}, '{}', signal())).rejects.toThrow(
      'invalid gateway status',
    );
    await expect(postGateway(`http://127.0.0.1:${port}/overflow`, {}, '{}', signal())).rejects.toThrow(
      'gateway response is too large',
    );
  });
});
