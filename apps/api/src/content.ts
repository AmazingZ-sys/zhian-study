import { Hono } from 'hono';
import { and, eq, ilike, sql, desc, or, inArray, gt, asc } from 'drizzle-orm';
import { z } from 'zod';
import { idSchema } from '@zhian/contracts';
import { matchJob } from '@zhian/shared';
import { db } from './db/index.js';
import {
  jobs,
  jobFavorites,
  jobVersions,
  announcements,
  announcementFavorites,
  profiles,
  majors,
  reminders,
} from './db/schema.js';
import { requireAuth } from './auth.js';
import { body, fail, uid, paramId, paging, type Env } from './lib.js';
export const jobView = (r: typeof jobs.$inferSelect) => ({
  ...r.data,
  id: r.id,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  version: r.version,
});
export const announcementView = (r: typeof announcements.$inferSelect) => ({
  ...r.data,
  id: r.id,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});
export const contentRoutes = new Hono<Env>();
contentRoutes.get('/major-catalog', async (c) => {
  const p = paging(c);
  const q = z
    .string()
    .max(100)
    .parse(c.req.query('q') ?? '');
  return c.json({
    data: await db
      .select()
      .from(majors)
      .where(q ? or(ilike(majors.name, `%${q}%`), eq(majors.code, q)) : undefined)
      .limit(p.pageSize)
      .offset(p.offset),
  });
});
contentRoutes.get('/jobs/favorites', requireAuth, async (c) => {
  const p = paging(c);
  const where = and(eq(jobFavorites.userId, uid(c)), eq(jobs.enabled, true));
  const [n] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobFavorites)
    .innerJoin(jobs, eq(jobs.id, jobFavorites.jobId))
    .where(where);
  const rows = await db
    .select({ job: jobs })
    .from(jobFavorites)
    .innerJoin(jobs, eq(jobs.id, jobFavorites.jobId))
    .where(where)
    .orderBy(desc(jobFavorites.createdAt))
    .limit(p.pageSize)
    .offset(p.offset);
  return c.json({
    data: rows.map((r) => ({ ...jobView(r.job), favorite: true })),
    meta: { page: p.page, pageSize: p.pageSize, total: n!.count },
  });
});
contentRoutes.get('/jobs', async (c) => {
  const p = paging(c);
  const f = z
    .object({
      q: z.string().max(100).optional(),
      year: z.coerce.number().int().min(2020).max(2100).optional(),
      examType: z.string().max(40).optional(),
      province: z.string().max(40).optional(),
      city: z.string().max(40).optional(),
      organization: z.string().max(200).optional(),
      education: z.string().max(40).optional(),
      degree: z.string().max(80).optional(),
      major: z.string().max(100).optional(),
      politicalStatus: z.string().max(100).optional(),
      workYears: z.coerce.number().min(0).max(60).optional(),
      minHeadcount: z.coerce.number().int().min(1).optional(),
      sort: z.enum(['newest', 'headcount', 'deadline']).default('newest'),
      ids: z.string().max(400).optional(),
    })
    .parse(c.req.query());
  const conditions = [eq(jobs.enabled, true)];
  if (f.q)
    conditions.push(
      or(ilike(jobs.title, `%${f.q}%`), ilike(jobs.organization, `%${f.q}%`), ilike(jobs.code, `%${f.q}%`))!,
    );
  for (const [value, column] of [
    [f.province, jobs.province],
    [f.city, jobs.city],
    [f.examType, jobs.examType],
    [f.education, jobs.education],
    [f.organization, jobs.organization],
  ] as const)
    if (value) conditions.push(eq(column, value));
  if (f.year) conditions.push(eq(jobs.year, f.year));
  if (f.minHeadcount) conditions.push(sql`${jobs.headcount}>=${f.minHeadcount}`);
  if (f.workYears !== undefined) conditions.push(sql`(${jobs.data}->>'workYears')::numeric<=${f.workYears}`);
  if (f.degree) conditions.push(sql`${jobs.data}->>'degree'=${f.degree}`);
  if (f.politicalStatus) conditions.push(sql`${jobs.data}->>'politicalStatus'=${f.politicalStatus}`);
  if (f.major) conditions.push(sql`${jobs.data}->>'majorText' ilike ${'%' + f.major + '%'}`);
  if (f.ids) conditions.push(inArray(jobs.id, z.array(idSchema).max(4).parse(f.ids.split(','))));
  const where = and(...conditions);
  const [n] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(where);
  const rows = await db
    .select()
    .from(jobs)
    .where(where)
    .orderBy(
      f.sort === 'headcount'
        ? desc(jobs.headcount)
        : f.sort === 'deadline'
          ? sql`${jobs.data}->>'registrationEnd' asc nulls last`
          : desc(jobs.createdAt),
      asc(jobs.id),
    )
    .limit(p.pageSize)
    .offset(p.offset);
  return c.json({ data: rows.map(jobView), meta: { page: p.page, pageSize: p.pageSize, total: n!.count } });
});
contentRoutes.post('/jobs/match', requireAuth, async (c) => {
  const { jobIds } = await body(c, z.object({ jobIds: z.array(idSchema).min(1).max(20) }));
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, uid(c)));
  const rows = await db
    .select()
    .from(jobs)
    .where(and(inArray(jobs.id, jobIds), eq(jobs.enabled, true)));
  const catalog = await db.select().from(majors);
  return c.json({ data: rows.map((r) => ({ jobId: r.id, ...matchJob(profile!.data, r.data, catalog) })) });
});
contentRoutes.get('/jobs/:id', async (c) => {
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, paramId(c)), eq(jobs.enabled, true)));
  if (!row) fail(404, '岗位不存在');
  const favorites = c.get('user')
    ? await db
        .select()
        .from(jobFavorites)
        .where(and(eq(jobFavorites.userId, uid(c)), eq(jobFavorites.jobId, row!.id)))
    : [];
  return c.json({ data: { ...jobView(row!), favorite: favorites.length > 0 } });
});
contentRoutes.get('/jobs/:id/history', async (c) => {
  const id = paramId(c);
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.enabled, true)));
  if (!job) fail(404, '岗位不存在');
  return c.json({
    data: await db
      .select()
      .from(jobVersions)
      .where(eq(jobVersions.jobId, id))
      .orderBy(desc(jobVersions.version))
      .limit(100),
  });
});
for (const method of ['post', 'delete'] as const)
  contentRoutes[method]('/jobs/:id/favorite', requireAuth, async (c) => {
    const id = paramId(c);
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.enabled, true)));
    if (!job) fail(404, '岗位不存在');
    await db.transaction(async (tx) => {
      if (method === 'post') {
        await tx
          .insert(jobFavorites)
          .values({ userId: uid(c), jobId: id })
          .onConflictDoNothing();
        if (job!.data.registrationEnd)
          await tx
            .insert(reminders)
            .values({
              userId: uid(c),
              jobId: id,
              dueAt: new Date(new Date(job!.data.registrationEnd).getTime() - 86400000),
            })
            .onConflictDoNothing();
      } else {
        await tx.delete(jobFavorites).where(and(eq(jobFavorites.userId, uid(c)), eq(jobFavorites.jobId, id)));
        await tx.delete(reminders).where(and(eq(reminders.userId, uid(c)), eq(reminders.jobId, id)));
      }
    });
    return c.json({ data: { favorite: method === 'post' } });
  });
contentRoutes.get('/reminders', requireAuth, async (c) => {
  const p = paging(c);
  const rows = await db
    .select({ id: reminders.id, dueAt: reminders.dueAt, read: reminders.read, job: jobs })
    .from(reminders)
    .innerJoin(jobs, eq(jobs.id, reminders.jobId))
    .where(
      and(
        eq(reminders.userId, uid(c)),
        eq(jobs.enabled, true),
        gt(reminders.dueAt, sql`now()-interval '30 days'`),
      ),
    )
    .orderBy(asc(reminders.dueAt))
    .limit(p.pageSize)
    .offset(p.offset);
  return c.json({ data: rows.map((r) => ({ ...r, job: jobView(r.job) })) });
});
contentRoutes.patch('/reminders/:id', requireAuth, async (c) => {
  await db
    .update(reminders)
    .set({ read: true, updatedAt: new Date() })
    .where(and(eq(reminders.id, paramId(c)), eq(reminders.userId, uid(c))));
  return c.json({ data: { ok: true } });
});
contentRoutes.get('/announcements', async (c) => {
  const p = paging(c),
    f = z
      .object({
        q: z.string().max(100).optional(),
        province: z.string().max(40).optional(),
        type: z.string().max(80).optional(),
        examType: z.string().max(40).optional(),
        favorite: z.enum(['true', 'false']).optional(),
      })
      .parse(c.req.query());
  const conditions = [eq(announcements.enabled, true)];
  if (f.q) conditions.push(ilike(announcements.title, `%${f.q}%`));
  if (f.province) conditions.push(eq(announcements.province, f.province));
  if (f.type) conditions.push(eq(announcements.type, f.type));
  if (f.examType) conditions.push(eq(announcements.examType, f.examType));
  if (f.favorite === 'true') {
    if (!c.get('user')) fail(401, '请先登录');
    const ids = await db
      .select()
      .from(announcementFavorites)
      .where(eq(announcementFavorites.userId, uid(c)));
    conditions.push(
      inArray(
        announcements.id,
        ids.map((r) => r.announcementId),
      ),
    );
  }
  const where = and(...conditions);
  const [n] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(announcements)
    .where(where);
  const rows = await db
    .select()
    .from(announcements)
    .where(where)
    .orderBy(desc(announcements.publishedAt))
    .limit(p.pageSize)
    .offset(p.offset);
  return c.json({
    data: rows.map(announcementView),
    meta: { page: p.page, pageSize: p.pageSize, total: n!.count },
  });
});
contentRoutes.get('/announcements/:id', async (c) => {
  const [r] = await db
    .select()
    .from(announcements)
    .where(and(eq(announcements.id, paramId(c)), eq(announcements.enabled, true)));
  if (!r) fail(404, '公告不存在');
  const f = c.get('user')
    ? await db
        .select()
        .from(announcementFavorites)
        .where(and(eq(announcementFavorites.userId, uid(c)), eq(announcementFavorites.announcementId, r!.id)))
    : [];
  return c.json({ data: { ...announcementView(r!), favorite: f.length > 0 } });
});
for (const method of ['post', 'delete'] as const)
  contentRoutes[method]('/announcements/:id/favorite', requireAuth, async (c) => {
    const id = paramId(c);
    const [a] = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), eq(announcements.enabled, true)));
    if (!a) fail(404, '公告不存在');
    if (method === 'post')
      await db
        .insert(announcementFavorites)
        .values({ userId: uid(c), announcementId: id })
        .onConflictDoNothing();
    else
      await db
        .delete(announcementFavorites)
        .where(and(eq(announcementFavorites.userId, uid(c)), eq(announcementFavorites.announcementId, id)));
    return c.json({ data: { favorite: method === 'post' } });
  });
