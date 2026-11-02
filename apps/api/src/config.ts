import { z } from 'zod';
const schema = z.object({
  DATABASE_URL: z.string().min(1).default('postgresql://zhian:local-development-only@localhost:5438/zhian'),
  JWT_SECRET: z.string().min(32).default('development-only-change-me-32-characters-minimum'),
  PORT: z.coerce.number().int().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  COOKIE_SAME_SITE: z.enum(['lax', 'none', 'strict']).default('lax'),
  TRUSTED_PROXY_IPS: z.string().default(''),
});
export const config = schema.parse(process.env);
if (
  config.NODE_ENV === 'production' &&
  (/development-|REPLACE_|change.me/i.test(config.JWT_SECRET) ||
    config.COOKIE_SECURE !== 'true' ||
    !process.env.DATABASE_URL ||
    !process.env.CORS_ORIGINS)
)
  throw new Error('生产环境必须提供安全密钥、数据库、CORS 和 Secure Cookie');
export const origins = config.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (config.NODE_ENV === 'production' && origins.some((origin) => !/^https:\/\/[^/]+$/.test(origin)))
  throw new Error('生产环境 CORS 必须是明确的 HTTPS origin');
export const trustedProxyIPs = config.TRUSTED_PROXY_IPS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
