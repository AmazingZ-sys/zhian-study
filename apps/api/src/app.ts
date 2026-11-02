import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { sql } from 'drizzle-orm';
import { config, origins, trustedProxyIPs } from './config.js';
import { db } from './db/index.js';
import { optionalAuth, authRoutes, userRoutes } from './auth.js';
import { questionRoutes } from './questions.js';
import { examRoutes } from './exams.js';
import { statsRoutes, planRoutes } from './statistics.js';
import { contentRoutes } from './content.js';
import { adminRoutes } from './admin.js';
import { openapi } from './openapi.js';
import { fail, type Env } from './lib.js';
export const app = new Hono<Env>();
app.use('*', secureHeaders());
app.use('*', async (c, next) => {
  const started = Date.now();
  c.set('requestId', randomUUID());
  c.header('X-Request-Id', c.get('requestId'));
  await next();
  if (config.NODE_ENV !== 'test')
    console.log(
      JSON.stringify({
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration: Date.now() - started,
      }),
    );
});
app.use(
  '/api/*',
  cors({
    origin: (o) => (origins.includes(o) ? o : ''),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposeHeaders: ['X-Request-Id'],
    maxAge: 600,
  }),
);
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 3 * 1024 * 1024,
    onError: (c) =>
      c.json(
        { error: { code: 'BODY_TOO_LARGE', message: '请求体不得超过 3MB' }, requestId: c.get('requestId') },
        413,
      ),
  }),
);
const buckets = new Map<string, { count: number; until: number }>();
app.use('/api/*', async (c, next) => {
  let ip = 'local';
  try {
    ip = getConnInfo(c).remote.address ?? 'local';
  } catch {
    /* app.request in integration tests has no socket */
  }
  const forwardedIP = c.req.header('x-real-ip');
  if (trustedProxyIPs.includes(ip) && forwardedIP && isIP(forwardedIP)) ip = forwardedIP;
  const auth = c.req.path.startsWith('/api/v1/auth/') && c.req.method === 'POST';
  const key = ip + (auth ? ':auth' : ':api'),
    now = Date.now();
  for (const [k, v] of buckets) if (v.until < now) buckets.delete(k);
  const entry = buckets.get(key) ?? { count: 0, until: now + 60000 };
  entry.count++;
  buckets.set(key, entry);
  if (entry.count > (auth ? 30 : 600)) {
    c.header('Retry-After', '60');
    fail(429, '请求过于频繁，请稍后重试');
  }
  await next();
});
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    const cookie = getCookie(c, 'zhian_access') || getCookie(c, 'zhian_refresh');
    if ((origin && !origins.includes(origin)) || (cookie && !origins.includes(origin ?? '')))
      fail(403, '请求来源校验失败');
  }
  c.header('Cache-Control', 'no-store');
  await next();
});
app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/ready', async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.json({ status: 'ready' });
  } catch {
    return c.json({ status: 'unavailable' }, 503);
  }
});
app.use('/api/v1/*', optionalAuth);
app.get('/api/v1/openapi.json', (c) => c.json(openapi));
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/users', userRoutes);
app.route('/api/v1', questionRoutes);
app.route('/api/v1/exams', examRoutes);
app.route('/api/v1/statistics', statsRoutes);
app.route('/api/v1/study-plans', planRoutes);
app.route('/api/v1', contentRoutes);
app.route('/api/v1/admin', adminRoutes);
app.notFound((c) =>
  c.json({ error: { code: 'NOT_FOUND', message: '接口不存在' }, requestId: c.get('requestId') }, 404),
);
app.onError((error, c) => {
  if (error instanceof ZodError)
    return c.json(
      {
        error: {
          code: 'VALIDATION',
          message: '输入格式不正确',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        requestId: c.get('requestId'),
      },
      400,
    );
  if (error instanceof HTTPException)
    return c.json(
      { error: { code: `HTTP_${error.status}`, message: error.message }, requestId: c.get('requestId') },
      error.status,
    );
  const cause = error.cause as { code?: string } | undefined;
  const code = cause?.code ?? (error as { code?: string }).code;
  if (code === '23505')
    return c.json(
      {
        error: { code: 'DUPLICATE', message: '数据已存在，请检查邮箱或唯一字段' },
        requestId: c.get('requestId'),
      },
      409,
    );
  if (code === '23503')
    return c.json(
      { error: { code: 'REFERENCE', message: '关联数据不存在或仍被引用' }, requestId: c.get('requestId') },
      400,
    );
  console.error(
    JSON.stringify({ requestId: c.get('requestId'), error: error.name, code: code ?? 'INTERNAL' }),
  );
  return c.json(
    { error: { code: 'INTERNAL', message: '服务暂时不可用，请稍后重试' }, requestId: c.get('requestId') },
    500,
  );
});
