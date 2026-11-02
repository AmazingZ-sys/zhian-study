import { Hono } from 'hono';
import { and, eq, sql, desc } from 'drizzle-orm';
import { db } from './db/index.js';
import { profiles, questionStates, attempts, practiceAnswers, studyPlans } from './db/schema.js';
import { requireAuth } from './auth.js';
import { settleExpired } from './exams.js';
import { uid, body, paramId, paging, fail, type Env } from './lib.js';
import { planSchema } from '@zhian/contracts';
import { percent, shanghaiDay } from '@zhian/utils';
export function answerFacts(userId: string) {
  return sql`with facts as (
 select a.created_at as at, a.correct, a.seconds, q.subject from practice_answers a join questions q on q.id=a.question_id where a.user_id=${userId}
 union all
 select t.submitted_at as at,a.correct,0 as seconds,p.snapshot->>'subject' as subject from exam_answers a join exam_attempts t on t.id=a.attempt_id join exam_paper_questions p on p.paper_id=t.paper_id and p.question_id=a.question_id where t.user_id=${userId} and t.status='submitted'
)`;
}
export const statsRoutes = new Hono<Env>();
statsRoutes.use('*', requireAuth);
statsRoutes.use('*', async (c, next) => {
  await settleExpired(uid(c));
  await next();
});
statsRoutes.get('/overview', async (c) => {
  const result = await db.execute<{ total: number; correct: number; seconds: number; today: number }>(
    sql`${answerFacts(uid(c))} select count(*)::int as total,count(*) filter(where correct)::int as correct,coalesce(sum(seconds),0)::int as seconds,count(*) filter(where (at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date)::int as today from facts`,
  );
  const days = await db.execute<{ day: string }>(
    sql`${answerFacts(uid(c))} select distinct to_char(at at time zone 'Asia/Shanghai','YYYY-MM-DD') as day from facts order by day desc limit 3660`,
  );
  const daysSet = new Set(days.rows.map((d) => d.day));
  let streak = 0;
  const cursor = new Date();
  if (!daysSet.has(shanghaiDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (daysSet.has(shanghaiDay(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const [state] = await db
    .select({
      wrong: sql<number>`count(*) filter(where ${questionStates.wrongCount}>0 and not ${questionStates.mastered})::int`,
      favorites: sql<number>`count(*) filter(where ${questionStates.favorite})::int`,
    })
    .from(questionStates)
    .where(eq(questionStates.userId, uid(c)));
  const [exam] = await db
    .select({
      count: sql<number>`count(*)::int`,
      seconds: sql<number>`coalesce(sum(extract(epoch from (${attempts.submittedAt}-${attempts.startedAt}))),0)::int`,
    })
    .from(attempts)
    .where(and(eq(attempts.userId, uid(c)), eq(attempts.status, 'submitted')));
  const [p] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, uid(c)));
  const r = result.rows[0]!;
  return c.json({
    data: {
      ...r,
      seconds: r.seconds + exam!.seconds,
      accuracy: percent(r.correct, r.total),
      streak,
      ...state,
      exams: exam!.count,
      dailyGoal: p!.data.dailyGoal,
    },
  });
});
statsRoutes.get('/daily', async (c) => {
  const result = await db.execute(
    sql`${answerFacts(uid(c))} select to_char(at at time zone 'Asia/Shanghai','YYYY-MM-DD') as date,count(*)::int as total,count(*) filter(where correct)::int as correct,count(*) filter(where not correct)::int as wrong,coalesce(sum(seconds),0)::int as seconds from facts where at>=now()-interval '30 days' group by date order by date`,
  );
  return c.json({ data: result.rows });
});
statsRoutes.get('/subjects', async (c) => {
  const result = await db.execute<{ subject: string; total: number; correct: number }>(
    sql`${answerFacts(uid(c))} select subject,count(*)::int as total,count(*) filter(where correct)::int as correct from facts group by subject order by subject`,
  );
  return c.json({ data: result.rows.map((r) => ({ ...r, accuracy: percent(r.correct, r.total) })) });
});
statsRoutes.get('/recent', async (c) =>
  c.json({
    data: await db
      .select({
        id: practiceAnswers.id,
        questionId: practiceAnswers.questionId,
        correct: practiceAnswers.correct,
        createdAt: practiceAnswers.createdAt,
        seconds: practiceAnswers.seconds,
      })
      .from(practiceAnswers)
      .where(eq(practiceAnswers.userId, uid(c)))
      .orderBy(desc(practiceAnswers.createdAt))
      .limit(10),
  }),
);
export const planRoutes = new Hono<Env>();
planRoutes.use('*', requireAuth);
planRoutes.get('/', async (c) => {
  const p = paging(c);
  const [n] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(studyPlans)
    .where(eq(studyPlans.userId, uid(c)));
  return c.json({
    data: await db
      .select()
      .from(studyPlans)
      .where(eq(studyPlans.userId, uid(c)))
      .orderBy(desc(studyPlans.createdAt))
      .limit(p.pageSize)
      .offset(p.offset),
    meta: { page: p.page, pageSize: p.pageSize, total: n!.count },
  });
});
planRoutes.post('/', async (c) => {
  const input = await body(c, planSchema);
  const [row] = await db
    .insert(studyPlans)
    .values({ ...input, userId: uid(c) })
    .returning();
  return c.json({ data: row }, 201);
});
planRoutes.patch('/:id', async (c) => {
  const input = await body(c, planSchema.partial());
  const rows = await db
    .update(studyPlans)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(studyPlans.id, paramId(c)), eq(studyPlans.userId, uid(c))))
    .returning();
  if (!rows.length) fail(404, '计划不存在');
  return c.json({ data: rows[0] });
});
planRoutes.delete('/:id', async (c) => {
  await db.delete(studyPlans).where(and(eq(studyPlans.id, paramId(c)), eq(studyPlans.userId, uid(c))));
  return c.json({ data: { ok: true } });
});
