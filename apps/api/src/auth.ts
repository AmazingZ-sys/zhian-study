import { randomBytes, createHash, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { authSchema, profileSchema, passwordSchema } from '@zhian/contracts';
import { db } from './db/index.js';
import { users, profiles, authSessions } from './db/schema.js';
import { config, origins } from './config.js';
import { body, fail, publicUser, uid, paramId, type Env } from './lib.js';
const scrypt = promisify(scryptCb);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const secret = new TextEncoder().encode(config.JWT_SECRET);
const cookieOptions = {
  httpOnly: true,
  secure: config.COOKIE_SECURE === 'true',
  sameSite:
    config.COOKIE_SAME_SITE === 'none'
      ? ('None' as const)
      : config.COOKIE_SAME_SITE === 'strict'
        ? ('Strict' as const)
        : ('Lax' as const),
  path: '/api/v1',
};
async function signAccess(userId: string, sessionId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer('zhian-api')
    .setAudience('zhian')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}
function requireWebOrigin(c: Context) {
  if (!origins.includes(c.req.header('origin') ?? '')) fail(403, 'Web 请求来源不受信任');
}
async function deliver(
  c: Context,
  userId: string,
  sessionId: string,
  refreshToken: string,
  client: 'web' | 'mobile',
) {
  const accessToken = await signAccess(userId, sessionId);
  if (client === 'web') {
    requireWebOrigin(c);
    setCookie(c, 'zhian_access', accessToken, { ...cookieOptions, maxAge: 900 });
    setCookie(c, 'zhian_refresh', refreshToken, { ...cookieOptions, maxAge: 30 * 86400 });
    return { expiresIn: 900 };
  }
  return { accessToken, refreshToken, expiresIn: 900 };
}
async function newSession(c: Context, userId: string, device: string, client: 'web' | 'mobile') {
  const token = randomBytes(48).toString('base64url');
  const [session] = await db
    .insert(authSessions)
    .values({ userId, device, refreshHash: digest(token), expiresAt: new Date(Date.now() + 30 * 86400000) })
    .returning();
  return deliver(c, userId, session!.id, `${session!.id}.${token}`, client);
}
export const optionalAuth: MiddlewareHandler<Env> = async (c, next) => {
  const token = c.req.header('authorization')?.replace(/^Bearer /, '') ?? getCookie(c, 'zhian_access');
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret, {
        issuer: 'zhian-api',
        audience: 'zhian',
        algorithms: ['HS256'],
      });
      if (typeof payload.sid === 'string' && typeof payload.sub === 'string') {
        const [record] = await db
          .select({ user: users, session: authSessions })
          .from(authSessions)
          .innerJoin(users, eq(users.id, authSessions.userId))
          .where(
            and(
              eq(authSessions.id, payload.sid),
              eq(users.id, payload.sub),
              isNull(authSessions.revokedAt),
              eq(users.active, true),
            ),
          )
          .limit(1);
        if (record && record.session.expiresAt > new Date()) {
          c.set('user', record.user);
          c.set('sessionId', record.session.id);
        }
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!code?.startsWith('ERR_J')) throw error; // Never turn database outages into anonymous requests.
    }
  }
  await next();
};
export const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get('user')) fail(401, '请先登录');
  await next();
};
export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get('user')) fail(401, '请先登录');
  if (c.get('user').role !== 'admin') fail(403, '需要管理员权限');
  await next();
};
export const authRoutes = new Hono<Env>();
authRoutes.post('/register', async (c) => {
  const input = await body(c, authSchema);
  if (input.client === 'web') requireWebOrigin(c);
  const passwordHash = await hashPassword(input.password);
  const user = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ email: input.email, name: input.name ?? input.email.split('@')[0]!, passwordHash })
      .returning();
    await tx.insert(profiles).values({ userId: u!.id, data: profileSchema.parse({}) });
    return u!;
  });
  return c.json(
    { data: { user: publicUser(user), ...(await newSession(c, user.id, input.device, input.client)) } },
    201,
  );
});
authRoutes.post('/login', async (c) => {
  const input = await body(c, authSchema);
  if (input.client === 'web') requireWebOrigin(c);
  const [user] = await db.select().from(users).where(eq(users.email, input.email));
  if (!user || !user.active || !(await verifyPassword(input.password, user.passwordHash)))
    fail(401, '邮箱或密码错误');
  return c.json({
    data: { user: publicUser(user!), ...(await newSession(c, user!.id, input.device, input.client)) },
  });
});
authRoutes.post('/refresh', async (c) => {
  const cookie = getCookie(c, 'zhian_refresh');
  const input = cookie
    ? { refreshToken: cookie, client: 'web' as const }
    : await body(c, z.object({ refreshToken: z.string().max(300), client: z.literal('mobile') }));
  if (input.client === 'web') requireWebOrigin(c);
  const [id, token] = input.refreshToken.split('.');
  if (!z.uuid().safeParse(id).success || !token) fail(401, '刷新会话无效');
  const nextToken = randomBytes(48).toString('base64url');
  const result = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(authSessions).where(eq(authSessions.id, id!)).for('update');
    if (!s || s.revokedAt || s.expiresAt <= new Date()) return null;
    const hash = digest(token!);
    if (s.refreshHash !== hash) {
      if (s.usedHashes.includes(hash))
        await tx
          .update(authSessions)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(eq(authSessions.id, s.id));
      return null;
    }
    const [u] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, s.userId), eq(users.active, true)));
    if (!u) return null;
    await tx
      .update(authSessions)
      .set({ refreshHash: digest(nextToken), usedHashes: [...s.usedHashes, hash], updatedAt: new Date() })
      .where(eq(authSessions.id, s.id));
    return s;
  });
  if (!result) fail(401, '会话已过期或已撤销，请重新登录');
  return c.json({
    data: await deliver(c, result!.userId, result!.id, `${result!.id}.${nextToken}`, input.client),
  });
});
authRoutes.post('/logout', async (c) => {
  if (c.get('sessionId'))
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.id, c.get('sessionId')));
  else {
    let refresh = getCookie(c, 'zhian_refresh');
    if (!refresh && c.req.header('content-type')?.includes('application/json')) {
      const input = await body(c, z.object({ client:z.literal('mobile'), refreshToken:z.string().max(300) }));
      refresh = input.refreshToken;
    }
    if (refresh) {
      if (getCookie(c, 'zhian_refresh')) requireWebOrigin(c);
      const [id, token] = refresh.split('.');
      if (z.uuid().safeParse(id).success && token)
        await db
          .update(authSessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(authSessions.id, id!), eq(authSessions.refreshHash, digest(token))));
    }
  }
  deleteCookie(c, 'zhian_access', cookieOptions);
  deleteCookie(c, 'zhian_refresh', cookieOptions);
  return c.json({ data: { ok: true } });
});
authRoutes.get('/me', requireAuth, (c) => c.json({ data: publicUser(c.get('user')) }));
export const userRoutes = new Hono<Env>();
userRoutes.use('*', requireAuth);
userRoutes.get('/me', async (c) => {
  const [p] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, uid(c)));
  return c.json({ data: { user: publicUser(c.get('user')), profile: p!.data } });
});
userRoutes.patch('/me', async (c) => {
  const input = await body(c, profileSchema);
  await db.transaction(async (tx) => {
    await tx
      .update(profiles)
      .set({ data: input, updatedAt: new Date() })
      .where(eq(profiles.userId, uid(c)));
    await tx
      .update(users)
      .set({
        ...(input.name ? { name: input.name } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, uid(c)));
  });
  return c.json({ data: input });
});
userRoutes.patch('/me/password', async (c) => {
  const input = await body(c, z.object({ currentPassword: passwordSchema, newPassword: passwordSchema }));
  if (!(await verifyPassword(input.currentPassword, c.get('user').passwordHash))) fail(400, '原密码不正确');
  const passwordHash = await hashPassword(input.newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, uid(c)));
    await tx
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.userId, uid(c)));
  });
  deleteCookie(c, 'zhian_access', cookieOptions);
  deleteCookie(c, 'zhian_refresh', cookieOptions);
  return c.json({ data: { ok: true } });
});
userRoutes.get('/me/sessions', async (c) =>
  c.json({
    data: await db
      .select({
        id: authSessions.id,
        device: authSessions.device,
        createdAt: authSessions.createdAt,
        expiresAt: authSessions.expiresAt,
        revokedAt: authSessions.revokedAt,
      })
      .from(authSessions)
      .where(eq(authSessions.userId, uid(c))),
  }),
);
userRoutes.delete('/me/sessions/:id', async (c) => {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.id, paramId(c)), eq(authSessions.userId, uid(c))));
  return c.json({ data: { ok: true } });
});
