import { Hono } from 'hono';
import { and, eq, gt, ilike, sql, desc, asc, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { answerSchema, idSchema } from '@zhian/contracts';
import { answersEqual } from '@zhian/shared';
import { db, type Tx } from './db/index.js';
import {
  questions,
  options,
  categories,
  questionStates,
  practiceAnswers,
  practiceSessions,
} from './db/schema.js';
import { requireAuth } from './auth.js';
import { body, fail, uid, paramId, paging, type Env } from './lib.js';
export async function loadQuestion(id: string, tx: Tx | typeof db = db) {
  const [q] = await tx.select().from(questions).where(eq(questions.id, id));
  if (!q) return null;
  return {
    ...q,
    options: await tx
      .select({ key: options.key, text: options.text })
      .from(options)
      .where(eq(options.questionId, id))
      .orderBy(asc(options.key)),
  };
}
export function hideAnswer(q: NonNullable<Awaited<ReturnType<typeof loadQuestion>>>) {
  const { correctAnswer: _a, explanation: _e, ...safe } = q;
  return safe;
}
export const questionRoutes = new Hono<Env>();
questionRoutes.get('/question-categories', async (c) => {
  const rows = await db.select().from(categories).orderBy(asc(categories.sort));
  const counts = await db
    .select({ categoryId: questions.categoryId, count: sql<number>`count(*)::int` })
    .from(questions)
    .where(eq(questions.enabled, true))
    .groupBy(questions.categoryId);
  return c.json({
    data: rows.map((r) => ({ ...r, count: counts.find((n) => n.categoryId === r.id)?.count ?? 0 })),
  });
});
questionRoutes.get('/questions', async (c) => {
  const { page, pageSize, offset } = paging(c);
  const query = z
    .object({
      q: z.string().max(100).optional(),
      categoryId: idSchema.optional(),
      subject: z.string().max(80).optional(),
      mode: z
        .enum(['sequential', 'random', 'chapter', 'special', 'past', 'favorite', 'wrong'])
        .default('sequential'),
      year: z.coerce.number().int().min(1990).max(2100).optional(),
      after: idSchema.optional(),
    })
    .parse(c.req.query());
  const conditions = [eq(questions.enabled, true)];
  if (query.q) conditions.push(ilike(questions.title, `%${query.q}%`));
  if (query.categoryId) conditions.push(eq(questions.categoryId, query.categoryId));
  if (query.subject) conditions.push(eq(questions.subject, query.subject));
  if (query.year) conditions.push(eq(questions.year, query.year));
  if (query.mode === 'past') conditions.push(sql`${questions.year} is not null`);
  if (query.after) {
    if (query.mode === 'random') conditions.push(sql`${questions.id} <> ${query.after}`);
    else {
      const [cursor] = await db
        .select({ createdAt: questions.createdAt })
        .from(questions)
        .where(eq(questions.id, query.after));
      if (!cursor) fail(400, '练习游标不存在');
      conditions.push(
        sql`(${questions.createdAt}, ${questions.id}) > (select created_at, id from questions where id = ${query.after}::uuid)`,
      );
    }
  }
  if (['favorite', 'wrong'].includes(query.mode)) {
    if (!c.get('user')) fail(401, '请先登录');
    const states = await db
      .select({ id: questionStates.questionId })
      .from(questionStates)
      .where(
        and(
          eq(questionStates.userId, uid(c)),
          query.mode === 'favorite'
            ? eq(questionStates.favorite, true)
            : and(gt(questionStates.wrongCount, 0), eq(questionStates.mastered, false)),
        ),
      );
    conditions.push(
      inArray(
        questions.id,
        states.map((s) => s.id),
      ),
    );
  }
  const where = and(...conditions);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(questions)
    .where(where);
  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(where)
    .orderBy(query.mode === 'random' ? sql`random()` : asc(questions.createdAt), asc(questions.id))
    .limit(pageSize)
    .offset(offset);
  const data = await Promise.all(rows.map(async (r) => hideAnswer((await loadQuestion(r.id))!)));
  return c.json({ data, meta: { page, pageSize, total: total!.count } });
});
questionRoutes.get('/questions/:id', async (c) => {
  const q = await loadQuestion(paramId(c));
  if (!q?.enabled) fail(404, '题目不存在');
  let state;
  if (c.get('user'))
    [state] = await db
      .select()
      .from(questionStates)
      .where(and(eq(questionStates.userId, uid(c)), eq(questionStates.questionId, q!.id)));
  return c.json({
    data: {
      ...hideAnswer(q!),
      favorite: state?.favorite ?? false,
      note: state?.note ?? '',
      wrongCount: state?.wrongCount ?? 0,
      mastered: state?.mastered ?? false,
    },
  });
});
questionRoutes.post('/practice-sessions', requireAuth, async (c) => {
  const input = await body(
    c,
    z.object({
      mode: z.enum(['sequential', 'random', 'chapter', 'special', 'past', 'favorite', 'wrong']),
      categoryId: idSchema.optional(),
    }),
  );
  const [s] = await db
    .insert(practiceSessions)
    .values({ ...input, userId: uid(c) })
    .returning();
  return c.json({ data: s }, 201);
});
questionRoutes.post('/questions/:id/answer', requireAuth, async (c) => {
  const id = paramId(c),
    input = await body(c, answerSchema);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${uid(c) + input.requestId}))`);
    const [existing] = await tx
      .select()
      .from(practiceAnswers)
      .where(and(eq(practiceAnswers.userId, uid(c)), eq(practiceAnswers.requestId, input.requestId)));
    if (existing) {
      if (existing.questionId !== id) fail(409, '幂等键已用于另一题');
      return existing;
    }
    const q = await loadQuestion(id, tx);
    if (!q?.enabled) fail(404, '题目不存在');
    if (
      input.answer.some((a) => !q!.options.some((o) => o.key === a)) ||
      new Set(input.answer).size !== input.answer.length ||
      (q!.type !== 'multiple' && input.answer.length !== 1)
    )
      fail(400, '所选答案不合法');
    if (input.sessionId) {
      const [s] = await tx
        .select()
        .from(practiceSessions)
        .where(and(eq(practiceSessions.id, input.sessionId), eq(practiceSessions.userId, uid(c))));
      if (!s) fail(404, '练习会话不存在');
    }
    const correct = answersEqual(input.answer, q!.correctAnswer);
    const [answer] = await tx
      .insert(practiceAnswers)
      .values({
        ...input,
        userId: uid(c),
        questionId: id,
        correct,
        correctAnswer: q!.correctAnswer,
        explanation: q!.explanation,
      })
      .returning();
    await tx
      .insert(questionStates)
      .values({ userId: uid(c), questionId: id, wrongCount: correct ? 0 : 1 })
      .onConflictDoUpdate({
        target: [questionStates.userId, questionStates.questionId],
        set: {
          wrongCount: sql`${questionStates.wrongCount}+${correct ? 0 : 1}`,
          ...(!correct ? { mastered: false } : {}),
          updatedAt: new Date(),
        },
      });
    return answer!;
  });
  return c.json({ data: result });
});
questionRoutes.get('/questions/:id/history', requireAuth, async (c) => {
  const p = paging(c);
  const where = and(eq(practiceAnswers.userId, uid(c)), eq(practiceAnswers.questionId, paramId(c)));
  const [n] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(practiceAnswers)
    .where(where);
  return c.json({
    data: await db
      .select()
      .from(practiceAnswers)
      .where(where)
      .orderBy(desc(practiceAnswers.createdAt))
      .limit(p.pageSize)
      .offset(p.offset),
    meta: { page: p.page, pageSize: p.pageSize, total: n!.count },
  });
});
for (const method of ['post', 'delete'] as const)
  questionRoutes[method]('/questions/:id/favorite', requireAuth, async (c) => {
    const id = paramId(c);
    const q = await loadQuestion(id);
    if (!q?.enabled) fail(404, '题目不存在');
    await db
      .insert(questionStates)
      .values({ userId: uid(c), questionId: id, favorite: method === 'post' })
      .onConflictDoUpdate({
        target: [questionStates.userId, questionStates.questionId],
        set: { favorite: method === 'post', updatedAt: new Date() },
      });
    return c.json({ data: { favorite: method === 'post' } });
  });
questionRoutes.patch('/questions/:id/note', requireAuth, async (c) => {
  const id = paramId(c),
    input = await body(c, z.object({ note: z.string().max(10000) }));
  if (!(await loadQuestion(id))) fail(404, '题目不存在');
  await db
    .insert(questionStates)
    .values({ userId: uid(c), questionId: id, ...input })
    .onConflictDoUpdate({
      target: [questionStates.userId, questionStates.questionId],
      set: { ...input, updatedAt: new Date() },
    });
  return c.json({ data: input });
});
questionRoutes.get('/wrong-questions', requireAuth, async (c) => {
  const p = paging(c);
  const f = z
    .object({
      subject: z.string().max(80).optional(),
      categoryId: idSchema.optional(),
      since: z.iso.datetime().optional(),
      sort: z.enum(['count', 'recent']).default('count'),
      mastered: z.enum(['true', 'false']).default('false'),
    })
    .parse(c.req.query());
  const where = and(
    eq(questionStates.userId, uid(c)),
    gt(questionStates.wrongCount, 0),
    eq(questionStates.mastered, f.mastered === 'true'),
    eq(questions.enabled, true),
    f.subject ? eq(questions.subject, f.subject) : undefined,
    f.categoryId ? eq(questions.categoryId, f.categoryId) : undefined,
    f.since ? gt(questionStates.updatedAt, new Date(f.since)) : undefined,
  );
  const [n] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(questionStates)
    .innerJoin(questions, eq(questions.id, questionStates.questionId))
    .where(where);
  const rows = await db
    .select({ state: questionStates })
    .from(questionStates)
    .innerJoin(questions, eq(questions.id, questionStates.questionId))
    .where(where)
    .orderBy(f.sort === 'count' ? desc(questionStates.wrongCount) : desc(questionStates.updatedAt))
    .limit(p.pageSize)
    .offset(p.offset);
  return c.json({
    data: await Promise.all(
      rows.map(async ({ state }) => ({
        ...hideAnswer((await loadQuestion(state.questionId))!),
        wrongCount: state.wrongCount,
        mastered: state.mastered,
        note: state.note,
        favorite: state.favorite,
      })),
    ),
    meta: { page: p.page, pageSize: p.pageSize, total: n!.count },
  });
});
questionRoutes.post('/wrong-questions/:id/retry', requireAuth, async (c) => {
  const [s] = await db
    .select()
    .from(questionStates)
    .where(
      and(
        eq(questionStates.userId, uid(c)),
        eq(questionStates.questionId, paramId(c)),
        gt(questionStates.wrongCount, 0),
      ),
    );
  if (!s) fail(404, '错题记录不存在');
  return c.json({ data: hideAnswer((await loadQuestion(s!.questionId))!) });
});
questionRoutes.patch('/wrong-questions/:id/mastered', requireAuth, async (c) => {
  const input = await body(c, z.object({ mastered: z.boolean() }));
  const rows = await db
    .update(questionStates)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(questionStates.userId, uid(c)),
        eq(questionStates.questionId, paramId(c)),
        gt(questionStates.wrongCount, 0),
      ),
    )
    .returning();
  if (!rows.length) fail(404, '错题记录不存在');
  return c.json({ data: input });
});
