import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { paginationSchema, idSchema } from '@zhian/contracts';
import type { users } from './db/schema.js';
export type Env = { Variables: { user: typeof users.$inferSelect; sessionId: string; requestId: string } };
export const fail = (status: 400 | 401 | 403 | 404 | 409 | 429, message: string) => {
  throw new HTTPException(status, { message });
};
export const uid = (c: Context<Env>) => c.get('user').id;
export const paramId = (c: Context<Env>) => idSchema.parse(c.req.param('id'));
export const paging = (c: Context) => {
  const p = paginationSchema.parse(c.req.query());
  return { ...p, offset: (p.page - 1) * p.pageSize };
};
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    fail(400, '请求体必须为合法 JSON');
  }
  return schema.parse(value);
}
export const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  avatarUrl: u.avatarUrl,
});
