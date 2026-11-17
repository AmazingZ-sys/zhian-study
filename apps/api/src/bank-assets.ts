import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { Env } from './lib.js';

const contentTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

// The default works from both apps/api/src and apps/api/dist; deployments set an explicit mount.
export const bankAssetDirectory = () =>
  resolve(
    process.env.QUESTION_BANK_ASSET_DIR ||
      fileURLToPath(new URL('../../../data/question-bank/assets/', import.meta.url)),
  );

// Register before secureHeaders so its default same-origin policy cannot block a separate Web origin.
export const bankAssetHeaders: MiddlewareHandler<Env> = async (c, next) => {
  await next();
  c.header('Cross-Origin-Resource-Policy', 'cross-origin');
};

export const bankAssetRoutes = new Hono<Env>();
bankAssetRoutes.get('/:name', async (c) => {
  const name = c.req.param('name');
  const ext = name.split('.').at(-1)?.toLowerCase() ?? '';
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,199}$/.test(name) || !contentTypes[ext])
    return c.notFound();
  try {
    const root = await realpath(bankAssetDirectory());
    const path = await realpath(resolve(root, name));
    if (!path.startsWith(root + sep)) return c.notFound();
    const content = await readFile(path);
    c.header('Content-Type', contentTypes[ext]);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(content);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
      return c.notFound();
    throw error;
  }
});
