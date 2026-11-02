import { Hono } from 'hono';
import { and, eq, sql, desc, asc } from 'drizzle-orm';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import {
  questionSchema,
  jobSchema,
  announcementSchema,
  categorySchema,
  sourceSchema,
  type QuestionInput,
  type JobInput,
  type AnnouncementInput,
} from '@zhian/contracts';
import { csvCell } from '@zhian/utils';
import { db, type Tx } from './db/index.js';
import {
  users,
  authSessions,
  questions,
  options,
  categories,
  jobs,
  jobVersions,
  announcements,
  sources,
  imports,
  auditLogs,
} from './db/schema.js';
import { requireAdmin } from './auth.js';
import { body, fail, uid, paramId, paging, publicUser, type Env } from './lib.js';
import { loadQuestion } from './questions.js';
import { jobView, announcementView } from './content.js';
export async function audit(tx: Tx, userId: string, action: string, objectId: string, result = 'success') {
  await tx.insert(auditLogs).values({ userId, action, objectId, result });
}
export async function saveQuestion(tx: Tx, input: QuestionInput, id?: string) {
  const { options: opts, ...data } = input;
  let row;
  if (id) {
    [row] = await tx
      .update(questions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(questions.id, id))
      .returning();
    if (!row) fail(404, '题目不存在');
    await tx.delete(options).where(eq(options.questionId, id));
  } else [row] = await tx.insert(questions).values(data).returning();
  await tx.insert(options).values(opts.map((o) => ({ ...o, questionId: row!.id })));
  return row!;
}
export async function saveJob(tx: Tx, input: JobInput, id?: string) {
  const values = {
    year: input.year,
    examType: input.examType,
    province: input.province,
    city: input.city,
    organization: input.organization,
    title: input.title,
    code: input.code,
    headcount: input.headcount,
    education: input.education,
    status: input.status,
    sourceId: input.sourceId,
    enabled: input.enabled,
    data: input,
  };
  let row;
  if (id) {
    const [old] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
    if (!old) fail(404, '岗位不存在');
    await tx.insert(jobVersions).values({ jobId: id, version: old!.version, data: old!.data });
    [row] = await tx
      .update(jobs)
      .set({ ...values, version: old!.version + 1, updatedAt: new Date() })
      .where(eq(jobs.id, id))
      .returning();
  } else [row] = await tx.insert(jobs).values(values).returning();
  return row!;
}
export async function saveAnnouncement(tx: Tx, input: AnnouncementInput, id?: string) {
  const values = {
    title: input.title,
    type: input.type,
    examType: input.examType,
    province: input.province,
    status: input.status,
    sourceId: input.sourceId,
    publishedAt: new Date(input.publishedAt),
    enabled: input.enabled,
    data: input,
  };
  const [row] = id
    ? await tx
        .update(announcements)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(announcements.id, id))
        .returning()
    : await tx.insert(announcements).values(values).returning();
  if (!row) fail(404, '公告不存在');
  return row!;
}
export const adminRoutes = new Hono<Env>();
adminRoutes.use('*', requireAdmin);
adminRoutes.get('/overview', async (c) => {
  const result = await db.execute(
    sql`select (select count(*)::int from users) as users,(select count(*)::int from questions where enabled) as questions,(select count(*)::int from jobs where enabled) as jobs,(select count(*)::int from announcements where enabled) as announcements`,
  );
  return c.json({ data: result.rows[0] });
});
adminRoutes.get('/users', async (c) => {
  const p = paging(c);
  const [n] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  const rows = await db
    .select()
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(p.pageSize)
    .offset(p.offset);
  return c.json({
    data: rows.map((u) => ({ ...publicUser(u), active: u.active, createdAt: u.createdAt })),
    meta: { page: p.page, pageSize: p.pageSize, total: n!.count },
  });
});
adminRoutes.get('/users/:id', async (c) => {
  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.id, paramId(c)));
  if (!u) fail(404, '用户不存在');
  return c.json({ data: { ...publicUser(u!), active: u!.active, createdAt: u!.createdAt } });
});
adminRoutes.patch('/users/:id', async (c) => {
  const id = paramId(c),
    input = await body(
      c,
      z.object({ role: z.enum(['user', 'admin']).optional(), active: z.boolean().optional() }),
    );
  if (id === uid(c)) fail(400, '不能在此修改自己的权限或状态');
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!rows.length) fail(404, '用户不存在');
    await tx.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.userId, id));
    await audit(tx, uid(c), 'user.update', id);
  });
  return c.json({ data: { ok: true } });
});
for (const kind of ['questions', 'jobs', 'announcements'] as const) {
  adminRoutes.get(`/${kind}`, async (c) => {
    const p = paging(c);
    let data: unknown[], total: number;
    if (kind === 'questions') {
      const rows = await db
        .select({ id: questions.id })
        .from(questions)
        .orderBy(desc(questions.createdAt))
        .limit(p.pageSize)
        .offset(p.offset);
      data = await Promise.all(rows.map((r) => loadQuestion(r.id)));
      const [n] = await db.select({ count: sql<number>`count(*)::int` }).from(questions);
      total = n!.count;
    } else if (kind === 'jobs') {
      data = (
        await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(p.pageSize).offset(p.offset)
      ).map(jobView);
      const [n] = await db.select({ count: sql<number>`count(*)::int` }).from(jobs);
      total = n!.count;
    } else {
      data = (
        await db
          .select()
          .from(announcements)
          .orderBy(desc(announcements.createdAt))
          .limit(p.pageSize)
          .offset(p.offset)
      ).map(announcementView);
      const [n] = await db.select({ count: sql<number>`count(*)::int` }).from(announcements);
      total = n!.count;
    }
    return c.json({ data, meta: { page: p.page, pageSize: p.pageSize, total } });
  });
  for (const method of ['post', 'patch'] as const)
    adminRoutes[method](`/${kind}${method === 'patch' ? '/:id' : ''}`, async (c) => {
      const id = method === 'patch' ? paramId(c) : undefined;
      const row = await db.transaction(async (tx) => {
        const r =
          kind === 'questions'
            ? await saveQuestion(tx, await body(c, questionSchema), id)
            : kind === 'jobs'
              ? await saveJob(tx, await body(c, jobSchema), id)
              : await saveAnnouncement(tx, await body(c, announcementSchema), id);
        await audit(tx, uid(c), `${kind}.${method}`, r.id);
        return r;
      });
      return c.json({ data: row }, method === 'post' ? 201 : 200);
    });
  adminRoutes.delete(`/${kind}/:id`, async (c) => {
    const id = paramId(c);
    await db.transaction(async (tx) => {
      if (kind === 'questions') {
        const r = await tx
          .update(questions)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(questions.id, id))
          .returning();
        if (!r.length) fail(404, '题目不存在');
      } else if (kind === 'jobs') {
        const [r] = await tx.select().from(jobs).where(eq(jobs.id, id));
        if (!r) fail(404, '岗位不存在');
        await saveJob(tx, { ...r!.data, enabled: false }, id);
      } else {
        const [r] = await tx.select().from(announcements).where(eq(announcements.id, id));
        if (!r) fail(404, '公告不存在');
        await saveAnnouncement(tx, { ...r!.data, enabled: false }, id);
      }
      await audit(tx, uid(c), `${kind}.disable`, id);
    });
    return c.json({ data: { ok: true } });
  });
}
adminRoutes.get('/categories', async (c) =>
  c.json({ data: await db.select().from(categories).orderBy(asc(categories.sort)) }),
);
for (const method of ['post', 'patch'] as const)
  adminRoutes[method](`/categories${method === 'patch' ? '/:id' : ''}`, async (c) => {
    const input = await body(c, categorySchema),
      id = method === 'patch' ? paramId(c) : undefined;
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(719034)`);
      let parent = input.parentId;
      const seen = new Set<string>();
      while (parent) {
        if (parent === id || seen.has(parent)) fail(400, '分类不能形成循环');
        seen.add(parent);
        const [p] = await tx.select().from(categories).where(eq(categories.id, parent));
        if (!p) fail(400, '父分类不存在');
        parent = p!.parentId;
      }
      const [r] = id
        ? await tx
            .update(categories)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(categories.id, id))
            .returning()
        : await tx.insert(categories).values(input).returning();
      if (!r) fail(404, '分类不存在');
      await audit(tx, uid(c), 'category.save', r!.id);
      return r;
    });
    return c.json({ data: row });
  });
adminRoutes.delete('/categories/:id', async (c) => {
  await db.transaction(async (tx) => {
    await tx.delete(categories).where(eq(categories.id, paramId(c)));
    await audit(tx, uid(c), 'category.delete', paramId(c));
  });
  return c.json({ data: { ok: true } });
});
adminRoutes.get('/sources', async (c) => {
  const p = paging(c);
  return c.json({
    data: await db.select().from(sources).orderBy(desc(sources.createdAt)).limit(p.pageSize).offset(p.offset),
  });
});
for (const method of ['post', 'patch'] as const)
  adminRoutes[method](`/sources${method === 'patch' ? '/:id' : ''}`, async (c) => {
    const input = await body(c, sourceSchema);
    const data = { ...input, fetchedAt: input.fetchedAt ? new Date(input.fetchedAt) : null };
    const row = await db.transaction(async (tx) => {
      const [r] =
        method === 'patch'
          ? await tx
              .update(sources)
              .set({ ...data, updatedAt: new Date() })
              .where(eq(sources.id, paramId(c)))
              .returning()
          : await tx.insert(sources).values(data).returning();
      if (!r) fail(404, '来源不存在');
      await audit(tx, uid(c), 'source.save', r!.id);
      return r;
    });
    return c.json({ data: row });
  });
adminRoutes.get('/audit-logs', async (c) => {
  const p = paging(c);
  const [n] = await db.select({ count: sql<number>`count(*)::int` }).from(auditLogs);
  return c.json({
    data: await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(p.pageSize)
      .offset(p.offset),
    meta: { page: p.page, pageSize: p.pageSize, total: n!.count },
  });
});
adminRoutes.get('/imports', async (c) => {
  const p = paging(c);
  const [n] = await db.select({ count: sql<number>`count(*)::int` }).from(imports);
  return c.json({
    data: await db.select().from(imports).orderBy(desc(imports.createdAt)).limit(p.pageSize).offset(p.offset),
    meta: { page: p.page, pageSize: p.pageSize, total: n!.count },
  });
});
function normalizeRow(row: Record<string, unknown>) {
  const result = { ...row };
  for (const k of ['options', 'correctAnswer', 'tags', 'majorCodes', 'attachments'])
    if (typeof result[k] === 'string') {
      try {
        result[k] = JSON.parse(result[k] as string);
      } catch {
        /* Zod reports malformed structured column */
      }
    }
  for (const k of ['year', 'headcount', 'workYears', 'minAge', 'maxAge', 'difficulty'])
    if (typeof result[k] === 'string' && result[k] !== '') result[k] = Number(result[k]);
  if (result.enabled === 'true' || result.enabled === 'false') result.enabled = result.enabled === 'true';
  for (const k of ['sourceId', 'imageUrl', 'year', 'registrationStart', 'registrationEnd', 'examAt'])
    if (result[k] === '') result[k] = null;
  return result;
}
adminRoutes.post('/imports', async (c) => {
  let raw: unknown, kind: string;
  if (c.req.header('content-type')?.includes('multipart/form-data')) {
    const form = await c.req.parseBody();
    kind = String(form.kind);
    const file = form.file;
    if (!(file instanceof File) || file.size > 2 * 1024 * 1024)
      fail(400, '请选择不超过 2MB 的 JSON/CSV/XLSX 文件');
    const f = file as File;
    const buffer = Buffer.from(await f.arrayBuffer());
    if (f.name.endsWith('.json')) {
      try {
        raw = JSON.parse(buffer.toString());
      } catch {
        fail(400, 'JSON 文件格式错误');
      }
    } else if (f.name.endsWith('.csv')) {
      try {
        raw = parse(buffer, { columns: true, skip_empty_lines: true, bom: true, max_record_size: 200000 });
      } catch {
        fail(400, 'CSV 文件格式错误');
      }
    } else if (f.name.endsWith('.xlsx')) {
      try {
        const book = XLSX.read(buffer, { type: 'buffer', sheetRows: 1002 });
        raw = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]!]!);
      } catch {
        fail(400, 'Excel 文件格式错误');
      }
    } else fail(400, '仅支持 JSON/CSV/XLSX');
  } else {
    const input = await body(
      c,
      z.object({
        kind: z.enum(['questions', 'jobs', 'announcements']),
        rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
      }),
    );
    kind = input.kind;
    raw = input.rows;
  }
  const type = z.enum(['questions', 'jobs', 'announcements']).parse(kind);
  const rows = z.array(z.record(z.string(), z.unknown())).min(1).max(1000).parse(raw).map(normalizeRow);
  const schema = type === 'questions' ? questionSchema : type === 'jobs' ? jobSchema : announcementSchema;
  const errors: { row: number; message: string }[] = [];
  rows.forEach((r, i) => {
    const v = schema.safeParse(r);
    if (!v.success)
      errors.push({
        row: i + 1,
        message: v.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      });
  });
  const [job] = await db
    .insert(imports)
    .values({ userId: uid(c), kind: type, status: 'validating', total: rows.length, errors })
    .returning();
  if (!errors.length) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'import-' + type}))`);
        const seen = new Set<string>();
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!;
          const key =
            type === 'jobs'
              ? `${row.code}|${row.year}|${row.organization}`
              : `${row.title}|${row.sourceLabel}`;
          if (seen.has(key)) {
            errors.push({ row: i + 1, message: '文件内重复数据' });
            continue;
          }
          seen.add(key);
          const existing =
            type === 'questions'
              ? await tx
                  .select({ id: questions.id })
                  .from(questions)
                  .where(
                    and(
                      eq(questions.title, String(row.title)),
                      eq(questions.sourceLabel, String(row.sourceLabel)),
                    ),
                  )
                  .limit(1)
              : type === 'jobs'
                ? await tx
                    .select({ id: jobs.id })
                    .from(jobs)
                    .where(
                      and(
                        eq(jobs.code, String(row.code)),
                        eq(jobs.year, Number(row.year)),
                        eq(jobs.organization, String(row.organization)),
                      ),
                    )
                    .limit(1)
                : await tx
                    .select({ id: announcements.id })
                    .from(announcements)
                    .where(eq(announcements.title, String(row.title)))
                    .limit(1);
          if (existing.length) errors.push({ row: i + 1, message: '数据库中已存在相同内容' });
        }
        if (errors.length) throw new Error('VALIDATION');
        for (let i = 0; i < rows.length; i++) {
          try {
            if (type === 'questions') await saveQuestion(tx, questionSchema.parse(rows[i]));
            else if (type === 'jobs') await saveJob(tx, jobSchema.parse(rows[i]));
            else await saveAnnouncement(tx, announcementSchema.parse(rows[i]));
          } catch {
            errors.push({ row: i + 1, message: '数据库约束校验失败，请检查分类/来源引用和唯一字段' });
            throw new Error('IMPORT_ROW');
          }
        }
        await tx
          .update(imports)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(imports.id, job!.id));
        await audit(tx, uid(c), 'import.' + type, job!.id);
      });
    } catch {
      if (!errors.length) errors.push({ row: 0, message: '事务失败，未写入任何内容' });
    }
  }
  if (errors.length)
    await db.transaction(async (tx) => {
      await tx
        .update(imports)
        .set({ status: 'failed', errors, updatedAt: new Date() })
        .where(eq(imports.id, job!.id));
      await audit(tx, uid(c), 'import.' + type, job!.id, 'failed');
    });
  return c.json(
    {
      data: {
        id: job!.id,
        status: errors.length ? 'failed' : 'completed',
        total: rows.length,
        imported: errors.length ? 0 : rows.length,
        errors,
      },
    },
    errors.length ? 400 : 201,
  );
});
adminRoutes.get('/imports/:id/errors', async (c) => {
  const [r] = await db
    .select()
    .from(imports)
    .where(eq(imports.id, paramId(c)));
  if (!r) fail(404, '导入任务不存在');
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="import-errors.csv"');
  return c.body('\uFEFFrow,message\n' + r!.errors.map((e) => `${e.row},${csvCell(e.message)}`).join('\n'));
});
adminRoutes.get('/exports/:kind', async (c) => {
  const kind = z.enum(['questions', 'jobs', 'announcements']).parse(c.req.param('kind'));
  const format = z.enum(['json', 'csv', 'xlsx']).parse(c.req.query('format') ?? 'json');
  const p = paging(c);
  const rows: Record<string, unknown>[] =
    kind === 'questions'
      ? await Promise.all(
          (
            await db
              .select({ id: questions.id })
              .from(questions)
              .orderBy(asc(questions.id))
              .limit(p.pageSize)
              .offset(p.offset)
          ).map(async (r) => (await loadQuestion(r.id))!),
        )
      : kind === 'jobs'
        ? (await db.select().from(jobs).orderBy(asc(jobs.id)).limit(p.pageSize).offset(p.offset)).map(jobView)
        : (
            await db
              .select()
              .from(announcements)
              .orderBy(asc(announcements.id))
              .limit(p.pageSize)
              .offset(p.offset)
          ).map(announcementView);
  await db.transaction((tx) => audit(tx, uid(c), 'export.' + kind, `${format}:page${p.page}`));
  c.header('Content-Disposition', `attachment; filename="${kind}-page${p.page}.${format}"`);
  if (format === 'json') return c.json(rows);
  const keys = Object.keys(rows[0] ?? {});
  if (format === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8');
    return c.body(
      '\uFEFF' +
        keys.map(csvCell).join(',') +
        '\n' +
        rows.map((r) => keys.map((k) => csvCell(r[k])).join(',')).join('\n'),
    );
  }
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v]),
      ),
    ),
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '数据');
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return c.body(new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })));
});
