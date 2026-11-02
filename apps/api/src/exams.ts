import { Hono } from 'hono';
import { and, eq, lte, sql, asc, desc } from 'drizzle-orm';
import { examCreateSchema, examAnswerSchema } from '@zhian/contracts';
import { answersEqual } from '@zhian/shared';
import { db, type Tx } from './db/index.js';
import { papers, paperQuestions, attempts, examAnswers, questions, questionStates } from './db/schema.js';
import { requireAuth } from './auth.js';
import { loadQuestion } from './questions.js';
import { body, fail, uid, paramId, paging, type Env } from './lib.js';
async function dbNow(tx: Tx | typeof db) {
  const r = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  return new Date(r.rows[0]!.now);
}
export async function finalizeExam(id: string, userId?: string, onlyExpired = false) {
  return db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, id), userId ? eq(attempts.userId, userId) : undefined))
      .for('update');
    if (!a) fail(404, '考试不存在');
    if (a!.status === 'submitted') return a!;
    const now = await dbNow(tx);
    if (onlyExpired && now < a!.deadline) return a!;
    const [paper] = await tx.select().from(papers).where(eq(papers.id, a!.paperId));
    const qs = await tx.select().from(paperQuestions).where(eq(paperQuestions.paperId, a!.paperId));
    const saved = await tx.select().from(examAnswers).where(eq(examAnswers.attemptId, id));
    let score = 0;
    for (const q of qs) {
      const answer = saved.find((s) => s.questionId === q.questionId)?.answer ?? [];
      const correct = answersEqual(answer, q.snapshot.correctAnswer);
      if (correct) score += paper!.points;
      await tx
        .insert(examAnswers)
        .values({ attemptId: id, questionId: q.questionId, answer, correct })
        .onConflictDoUpdate({
          target: [examAnswers.attemptId, examAnswers.questionId],
          set: { correct, updatedAt: now },
        });
      await tx
        .insert(questionStates)
        .values({ userId: a!.userId, questionId: q.questionId, wrongCount: correct ? 0 : 1 })
        .onConflictDoUpdate({
          target: [questionStates.userId, questionStates.questionId],
          set: {
            wrongCount: sql`${questionStates.wrongCount}+${correct ? 0 : 1}`,
            ...(!correct ? { mastered: false } : {}),
            updatedAt: now,
          },
        });
    }
    const [done] = await tx
      .update(attempts)
      .set({ status: 'submitted', score, submittedAt: now > a!.deadline ? a!.deadline : now, updatedAt: now })
      .where(eq(attempts.id, id))
      .returning();
    return done!;
  });
}
export async function settleExpired(userId?: string) {
  const rows = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(
      and(
        eq(attempts.status, 'active'),
        lte(attempts.deadline, sql`now()`),
        userId ? eq(attempts.userId, userId) : undefined,
      ),
    )
    .limit(100);
  for (const r of rows) await finalizeExam(r.id, undefined, true);
}
async function examView(id: string, userId: string) {
  const a = await finalizeExam(id, userId, true);
  const [p] = await db.select().from(papers).where(eq(papers.id, a.paperId));
  const qs = await db
    .select()
    .from(paperQuestions)
    .where(eq(paperQuestions.paperId, a.paperId))
    .orderBy(asc(paperQuestions.position));
  const saved = await db.select().from(examAnswers).where(eq(examAnswers.attemptId, id));
  return {
    ...a,
    title: p!.title,
    points: p!.points,
    total: qs.length,
    serverNow: await dbNow(db),
    questions: qs.map((q) => {
      const { correctAnswer, explanation, ...safe } = q.snapshot;
      const answer = saved.find((s) => s.questionId === q.questionId);
      return {
        ...safe,
        answer: answer?.answer ?? [],
        ...(a.status === 'submitted'
          ? { correctAnswer, explanation, correct: answer?.correct ?? false }
          : {}),
      };
    }),
  };
}
export const examRoutes = new Hono<Env>();
examRoutes.use('*', requireAuth);
examRoutes.get('/', async (c) => {
  const p = paging(c);
  const expired = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(
      and(eq(attempts.userId, uid(c)), eq(attempts.status, 'active'), lte(attempts.deadline, sql`now()`)),
    );
  for (const r of expired) await finalizeExam(r.id, uid(c), true);
  const [n] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attempts)
    .where(eq(attempts.userId, uid(c)));
  const rows = await db
    .select({
      id: attempts.id,
      title: papers.title,
      status: attempts.status,
      score: attempts.score,
      startedAt: attempts.startedAt,
      deadline: attempts.deadline,
      submittedAt: attempts.submittedAt,
      points: papers.points,
    })
    .from(attempts)
    .innerJoin(papers, eq(papers.id, attempts.paperId))
    .where(eq(attempts.userId, uid(c)))
    .orderBy(desc(attempts.createdAt))
    .limit(p.pageSize)
    .offset(p.offset);
  return c.json({ data: rows, meta: { page: p.page, pageSize: p.pageSize, total: n!.count } });
});
examRoutes.post('/', async (c) => {
  const input = await body(c, examCreateSchema);
  await settleExpired(uid(c));
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'exam-create:' + uid(c)}))`);
    const active = await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, uid(c)), eq(attempts.status, 'active')));
    if (active.length >= 5) fail(409, '请先完成已有考试（最多 5 场进行中）');
    const qs = await tx
      .select({ id: questions.id })
      .from(questions)
      .where(
        and(
          eq(questions.enabled, true),
          input.categoryId ? eq(questions.categoryId, input.categoryId) : undefined,
        ),
      )
      .orderBy(sql`random()`)
      .limit(input.count);
    if (qs.length < input.count) fail(400, `可用题目不足，当前仅 ${qs.length} 题`);
    const [paper] = await tx
      .insert(papers)
      .values({ title: input.title, minutes: input.minutes, points: input.points })
      .returning();
    for (let i = 0; i < qs.length; i++)
      await tx.insert(paperQuestions).values({
        paperId: paper!.id,
        questionId: qs[i]!.id,
        position: i,
        snapshot: (await loadQuestion(qs[i]!.id, tx))!,
      });
    const now = await dbNow(tx);
    const [attempt] = await tx
      .insert(attempts)
      .values({
        userId: uid(c),
        paperId: paper!.id,
        startedAt: now,
        deadline: new Date(now.getTime() + input.minutes * 60000),
      })
      .returning();
    return attempt!;
  });
  return c.json({ data: await examView(result.id, uid(c)) }, 201);
});
examRoutes.get('/:id', async (c) => c.json({ data: await examView(paramId(c), uid(c)) }));
examRoutes.patch('/:id/answers', async (c) => {
  const id = paramId(c),
    input = await body(c, examAnswerSchema);
  let expired = false;
  await db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, id), eq(attempts.userId, uid(c))))
      .for('update');
    if (!a) fail(404, '考试不存在');
    if (a!.status !== 'active') fail(409, '考试已交卷');
    const now = await dbNow(tx);
    if (now >= a!.deadline) {
      expired = true;
      return;
    }
    const [q] = await tx
      .select()
      .from(paperQuestions)
      .where(and(eq(paperQuestions.paperId, a!.paperId), eq(paperQuestions.questionId, input.questionId)));
    if (!q) fail(400, '题目不属于当前试卷');
    if (
      input.answer.some((a) => !q!.snapshot.options.some((o) => o.key === a)) ||
      new Set(input.answer).size !== input.answer.length ||
      (q!.snapshot.type !== 'multiple' && input.answer.length > 1)
    )
      fail(400, '答案不合法');
    await tx
      .insert(examAnswers)
      .values({ ...input, attemptId: id })
      .onConflictDoUpdate({
        target: [examAnswers.attemptId, examAnswers.questionId],
        set: { answer: input.answer, updatedAt: now },
      });
  });
  if (expired) {
    await finalizeExam(id, uid(c), true);
    fail(409, '考试已截止，已自动交卷');
  }
  return c.json({ data: { saved: true, serverNow: await dbNow(db) } });
});
examRoutes.post('/:id/submit', async (c) => {
  await finalizeExam(paramId(c), uid(c));
  return c.json({ data: await examView(paramId(c), uid(c)) });
});
examRoutes.get('/:id/result', async (c) => {
  const result = await examView(paramId(c), uid(c));
  if (result.status !== 'submitted') fail(409, '考试尚未交卷');
  return c.json({ data: result });
});
