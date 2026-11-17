import { Hono } from 'hono';
import { and, eq, gt, ilike, sql, desc, asc, inArray, getTableColumns } from 'drizzle-orm';
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
  sourcePapers,
  sourcePaperQuestions,
} from './db/schema.js';
import { requireAuth } from './auth.js';
import { body, fail, uid, paramId, paging, type Env } from './lib.js';
export async function loadQuestion(id: string, tx: Tx | typeof db = db, paperId?: string) {
  const [q] = await tx.select().from(questions).where(eq(questions.id, id));
  if (!q) return null;
  let context: { sourceLabel: string; year: number | null; material: string } | undefined;
  if (paperId) {
    const [paper] = await tx
      .select({ title: sourcePapers.title, year: sourcePapers.year, materials: sourcePapers.materials })
      .from(sourcePapers)
      .innerJoin(sourcePaperQuestions, eq(sourcePaperQuestions.paperId, sourcePapers.id))
      .where(and(eq(sourcePapers.id, paperId), eq(sourcePaperQuestions.questionId, id)))
      .limit(1);
    if (!paper) fail(404, '题目不属于指定原试卷');
    context = {
      sourceLabel: paper!.title,
      year: paper!.year,
      material:
        q.type === 'subjective' && paper!.materials.length
          ? paper!.materials.map((item) => [item.title, item.text].filter(Boolean).join('\n')).join('\n\n')
          : q.material,
    };
  }
  return {
    ...q,
    ...context,
    options: await tx
      .select({ key: options.key, text: options.text })
      .from(options)
      .where(eq(options.questionId, id))
      .orderBy(asc(options.key)),
  };
}
export function hideAnswer(q: NonNullable<Awaited<ReturnType<typeof loadQuestion>>>) {
  const { correctAnswer: _a, explanation: _e, externalKey: _k, ...safe } = q;
  return safe;
}
const categoryScope = z.object({
  categoryId: idSchema.optional(),
  includeDescendants: z.enum(['true', 'false']).optional(),
});
const wrongFilters = z.object({
  since: z.iso.datetime().optional(),
  mastered: z.enum(['true', 'false']).default('false'),
});
function categoryCondition({ categoryId, includeDescendants }: z.output<typeof categoryScope>) {
  if (!categoryId) return undefined;
  if (includeDescendants !== 'true') return eq(questions.categoryId, categoryId);
  return inArray(
    questions.categoryId,
    sql`(with recursive category_scope(id) as (
      select ${categories.id} from ${categories} where ${categories.id} = ${categoryId}
      union
      select ${categories.id} from ${categories} join category_scope on ${categories.parentId} = category_scope.id
    ) select id from category_scope)`,
  );
}
function wrongConditions(userId: string, { mastered, since }: z.output<typeof wrongFilters>) {
  return [
    eq(questionStates.userId, userId),
    gt(questionStates.wrongCount, 0),
    eq(questionStates.mastered, mastered === 'true'),
    since ? gt(questionStates.updatedAt, new Date(since)) : undefined,
  ];
}
export const questionRoutes = new Hono<Env>();
export const questionPaperRoutes = new Hono<Env>();
const { raw: _paperRaw, externalKey: _paperKey, ...publicPaperFields } = getTableColumns(sourcePapers);
questionPaperRoutes.get('/', async (c) => {
  const { page, pageSize, offset } = paging(c);
  const query = z
    .object({ q: z.string().max(100).optional(), subject: z.string().max(80).optional() })
    .parse(c.req.query());
  const where = and(
    query.q ? ilike(sourcePapers.title, `%${query.q}%`) : undefined,
    query.subject ? eq(sourcePapers.subject, query.subject) : undefined,
  );
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sourcePapers)
    .where(where);
  const data = await db
    .select(publicPaperFields)
    .from(sourcePapers)
    .where(where)
    .orderBy(desc(sourcePapers.year), asc(sourcePapers.title), asc(sourcePapers.id))
    .limit(pageSize)
    .offset(offset);
  return c.json({ data, meta: { page, pageSize, total: total!.count } });
});
questionPaperRoutes.get('/:id', async (c) => {
  const id = paramId(c);
  const { page, pageSize, offset } = paging(c);
  const [paper] = await db.select(publicPaperFields).from(sourcePapers).where(eq(sourcePapers.id, id));
  if (!paper) fail(404, '原试卷不存在');
  const where = and(eq(sourcePaperQuestions.paperId, id), eq(questions.enabled, true));
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sourcePaperQuestions)
    .innerJoin(questions, eq(questions.id, sourcePaperQuestions.questionId))
    .where(where);
  const rows = await db
    .select({
      id: questions.id,
      title: questions.title,
      type: questions.type,
      subject: questions.subject,
      position: sourcePaperQuestions.position,
    })
    .from(sourcePaperQuestions)
    .innerJoin(questions, eq(questions.id, sourcePaperQuestions.questionId))
    .where(where)
    .orderBy(asc(sourcePaperQuestions.position))
    .limit(pageSize)
    .offset(offset);
  return c.json({ data: { ...paper!, questions: rows }, meta: { page, pageSize, total: total!.count } });
});
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
questionRoutes.get('/question-categories/progress', requireAuth, async (c) => {
  const rows = await db
    .select({
      ...getTableColumns(categories),
      count: sql<number>`count(distinct ${questions.id})::int`,
      attempted: sql<number>`count(distinct ${practiceAnswers.questionId})::int`,
      attempts: sql<number>`count(${practiceAnswers.id})::int`,
      correctAttempts: sql<number>`count(${practiceAnswers.id}) filter (where ${practiceAnswers.correct})::int`,
    })
    .from(categories)
    .leftJoin(questions, and(eq(questions.categoryId, categories.id), eq(questions.enabled, true)))
    .leftJoin(
      practiceAnswers,
      and(eq(practiceAnswers.questionId, questions.id), eq(practiceAnswers.userId, uid(c))),
    )
    .groupBy(categories.id)
    .orderBy(asc(categories.sort), asc(categories.id));
  return c.json({ data: rows });
});
questionRoutes.get('/questions', async (c) => {
  const { page, pageSize, offset } = paging(c);
  const query = z
    .object({
      ...categoryScope.shape,
      q: z.string().max(100).optional(),
      subject: z.string().max(80).optional(),
      mode: z
        .enum(['sequential', 'random', 'chapter', 'special', 'past', 'favorite', 'wrong'])
        .default('sequential'),
      year: z.coerce.number().int().min(1990).max(2100).optional(),
      after: idSchema.optional(),
      paperId: idSchema.optional(),
    })
    .parse(c.req.query());
  const conditions = [eq(questions.enabled, true), categoryCondition(query)];
  if (query.paperId) {
    const [paper] = await db
      .select({ id: sourcePapers.id })
      .from(sourcePapers)
      .where(eq(sourcePapers.id, query.paperId));
    if (!paper) fail(404, '原试卷不存在');
    conditions.push(
      inArray(
        questions.id,
        db
          .select({ questionId: sourcePaperQuestions.questionId })
          .from(sourcePaperQuestions)
          .where(eq(sourcePaperQuestions.paperId, query.paperId)),
      ),
    );
  }
  const paperPosition = sql<number>`(select min(position) from source_paper_questions where paper_id = ${query.paperId}::uuid and question_id = ${questions.id})`;
  if (query.q) conditions.push(ilike(questions.title, `%${query.q}%`));
  if (query.subject) conditions.push(eq(questions.subject, query.subject));
  if (query.year) conditions.push(eq(questions.year, query.year));
  if (query.mode === 'past') conditions.push(sql`${questions.year} is not null`);
  if (query.after) {
    if (query.paperId) {
      const [cursor] = await db
        .select({ position: sourcePaperQuestions.position })
        .from(sourcePaperQuestions)
        .where(
          and(
            eq(sourcePaperQuestions.paperId, query.paperId),
            eq(sourcePaperQuestions.questionId, query.after),
          ),
        )
        .orderBy(asc(sourcePaperQuestions.position))
        .limit(1);
      if (!cursor) fail(400, '练习游标不属于当前原试卷');
      conditions.push(
        query.mode === 'random'
          ? sql`${questions.id} <> ${query.after}`
          : gt(paperPosition, cursor!.position),
      );
    } else if (query.mode === 'random') conditions.push(sql`${questions.id} <> ${query.after}`);
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
    const states = db
      .select({ id: questionStates.questionId })
      .from(questionStates)
      .where(
        query.mode === 'favorite'
          ? and(eq(questionStates.userId, uid(c)), eq(questionStates.favorite, true))
          : and(...wrongConditions(uid(c), wrongFilters.parse(c.req.query()))),
      );
    conditions.push(inArray(questions.id, states));
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
    .orderBy(
      query.mode === 'random' ? sql`random()` : query.paperId ? asc(paperPosition) : asc(questions.createdAt),
      asc(questions.id),
    )
    .limit(pageSize)
    .offset(offset);
  const data = await Promise.all(
    rows.map(async (r) => hideAnswer((await loadQuestion(r.id, db, query.paperId))!)),
  );
  return c.json({ data, meta: { page, pageSize, total: total!.count } });
});
questionRoutes.get('/questions/:id', async (c) => {
  const paperId = idSchema.optional().parse(c.req.query('paperId'));
  const q = await loadQuestion(paramId(c), db, paperId);
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
questionRoutes.get('/questions/:id/solution', requireAuth, async (c) => {
  const q = await loadQuestion(paramId(c));
  if (!q?.enabled) fail(404, '题目不存在');
  if (q!.type !== 'subjective') fail(400, '客观题请先提交答案');
  return c.json({ data: { explanation: q!.explanation } });
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
    if (q!.type === 'subjective') fail(400, '主观阅读题不支持自动计分，请查看参考解析');
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
      ...categoryScope.shape,
      ...wrongFilters.shape,
      subject: z.string().max(80).optional(),
      sort: z.enum(['count', 'recent']).default('count'),
    })
    .parse(c.req.query());
  const where = and(
    ...wrongConditions(uid(c), f),
    eq(questions.enabled, true),
    f.subject ? eq(questions.subject, f.subject) : undefined,
    categoryCondition(f),
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
