import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { bankAssetHeaders, bankAssetRoutes } from '../src/bank-assets';

describe('本地题库图片', () => {
  let directory: string;
  const previous = process.env.QUESTION_BANK_ASSET_DIR;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGKoAAAAASUVORK5CYII=', 'base64');
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'zhian-bank-assets-'));
    process.env.QUESTION_BANK_ASSET_DIR = directory;
    await writeFile(join(directory, 'figure.png'), png);
    await writeFile(join(directory, 'active.svg'), '<svg onload="alert(1)"/>');
    await symlink(join(directory, '..'), join(directory, 'outside.png'));
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.QUESTION_BANK_ASSET_DIR;
    else process.env.QUESTION_BANK_ASSET_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  it('提供图片字节、正确类型和禁止嗅探响应头', async () => {
    const response = await bankAssetRoutes.request('/figure.png');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });
  it('拒绝活动格式、目录穿越、外部符号链接和不存在文件', async () => {
    for (const path of ['/active.svg', '/..%2F.env.png', '/outside.png', '/missing.png']) {
      expect((await bankAssetRoutes.request(path)).status, path).toBe(404);
    }
  });
  it('允许独立部署的前端嵌入图片并保留其他安全头', async () => {
    const app = new Hono()
      .use('/bank-assets/*', bankAssetHeaders)
      .use('*', secureHeaders())
      .route('/bank-assets', bankAssetRoutes);
    const response = await app.request('/bank-assets/figure.png');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });
});
