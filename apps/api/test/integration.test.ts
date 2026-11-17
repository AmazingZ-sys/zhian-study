import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { Hono } from 'hono';
import type { Env } from '../src/lib';

async function createAiGateway() {
  const calls: { path?: string; method?: string; auth?: string; body: string }[] = [];
  let reply: { status: number; body: unknown; location?: string } = { status: 200, body: {} };
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request.setEncoding('utf8')) body += chunk;
    calls.push({ path: request.url, method: request.method, auth: request.headers.authorization, body });
    response.writeHead(reply.status, {
      'Content-Type': 'application/json',
      ...(reply.location ? { Location: reply.location } : {}),
    });
    response.end(JSON.stringify(reply.body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试网关监听失败');
  return {
    url: `http://127.0.0.1:${address.port}/relay/v1`,
    calls,
    respond(text: string) {
      reply = { status: 200, body: { choices: [{ message: { content: text } }] } };
    },
    fail(status: number, body: unknown, location?: string) {
      reply = { status, body, location };
    },
    async close() {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    },
  };
}

const enabled = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!enabled)('真实 PostgreSQL API 集成', () => {
  let app: Hono<Env>, pool: (typeof import('../src/db/index'))['pool'];
  let primaryGateway: Awaited<ReturnType<typeof createAiGateway>>;
  let secondaryGateway: Awaited<ReturnType<typeof createAiGateway>>;
  let token = '',
    otherToken = '',
    adminToken = '',
    userId = '',
    refresh = '',
    questionId = '',
    categoryId = '',
    jobId = '',
    announcementId = '',
    examId = '';
  const suffix = randomUUID();
  const request = async (
    path: string,
    method = 'GET',
    data?: unknown,
    auth = token,
    extra: Record<string, string> = {},
  ) => {
    const response = await app.request('/api/v1' + path, {
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
        ...extra,
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ?? 'postgresql://zhian:local-development-only@localhost:5438/zhian_test';
    if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
      throw new Error('集成测试必须使用以 _test 结尾的独立数据库');
    for (const name of ['AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY', 'AI_TOKEN_LIMIT_FIELD'])
      delete process.env[name];
    ({ app } = await import('../src/app'));
    ({ pool } = await import('../src/db/index'));
  });
  afterAll(async () => {
    await Promise.all([pool?.end(), primaryGateway?.close(), secondaryGateway?.close()]);
  });
  it('注册、登录、资料隔离及管理员鉴权', async () => {
    const email = `integration-${suffix}@example.com`,
      password = 'test-password-unique-123';
    const a = await request(
      '/auth/register',
      'POST',
      { email, password, client: 'mobile', name: '集成测试' },
      '',
    );
    expect(a.status).toBe(201);
    token = a.body.data.accessToken;
    refresh = a.body.data.refreshToken;
    userId = a.body.data.user.id;
    expect(
      (await request('/auth/login', 'POST', { email, password: 'wrong-password-123', client: 'mobile' }, ''))
        .status,
    ).toBe(401);
    expect((await request('/auth/login', 'POST', { email, password, client: 'mobile' }, '')).status).toBe(
      200,
    );
    const b = await request(
      '/auth/register',
      'POST',
      { email: `other-${suffix}@example.com`, password, client: 'mobile' },
      '',
    );
    otherToken = b.body.data.accessToken;
    expect((await request('/admin/users')).status).toBe(403);
    const admin = await request(
      '/auth/register',
      'POST',
      { email: `admin-${suffix}@example.com`, password, client: 'mobile' },
      '',
    );
    adminToken = admin.body.data.accessToken;
    await pool.query("update users set role='admin' where id=$1", [admin.body.data.user.id]);
    expect((await request('/admin/users', 'GET', undefined, adminToken)).status).toBe(200);
    expect((await request('/users/me', 'PATCH', { age: 25, major: '软件工程', dailyGoal: 40 })).status).toBe(
      200,
    );
    expect((await request('/users/me', 'GET', undefined, otherToken)).body.data.profile.age).toBeNull();
  });
  it('Web Cookie、CSRF 和来源白名单', async () => {
    const a = await request(
      '/auth/login',
      'POST',
      { email: `integration-${suffix}@example.com`, password: 'test-password-unique-123', client: 'web' },
      '',
      { Origin: 'http://127.0.0.1:5173' },
    );
    expect(a.status).toBe(200);
    const cookies = a.headers.getSetCookie();
    expect(cookies.join(';')).toContain('HttpOnly');
    const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    expect(
      (
        await request('/users/me', 'PATCH', { age: 25 }, '', {
          Cookie: cookie,
          Origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    expect((await request('/users/me', 'PATCH', { age: 25 }, '', { Cookie: cookie })).status).toBe(403);
    expect((await request('/auth/register', 'POST', { email: 'bad', password: '123' }, '')).status).toBe(400);
  });
  it('管理员新增题目；公开题库不泄露答案', async () => {
    const cats = await request('/question-categories');
    categoryId = cats.body.data[0].id;
    const q = await request(
      '/admin/questions',
      'POST',
      {
        title: '集成测试 ' + suffix,
        subject: '数量关系',
        categoryId,
        type: 'multiple',
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
          { key: 'C', text: '3' },
        ],
        correctAnswer: ['A', 'C'],
        explanation: '测试用解析',
        sourceLabel: '原创测试',
        status: 'demo',
      },
      adminToken,
    );
    expect(q.status).toBe(201);
    questionId = q.body.data.id;
    const pub = await request('/questions/' + questionId);
    expect(pub.body.data.correctAnswer).toBeUndefined();
    expect(pub.body.data.explanation).toBeUndefined();
    expect((await request('/questions/not-uuid')).status).toBe(400);
  });
  it('错题收录、幂等答题、收藏、笔记与用户隔离', async () => {
    const requestId = randomUUID();
    const results = await Promise.all([
      request('/questions/' + questionId + '/answer', 'POST', { answer: ['B'], seconds: 10, requestId }),
      request('/questions/' + questionId + '/answer', 'POST', { answer: ['B'], seconds: 10, requestId }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0]!.body.data.id).toBe(results[1]!.body.data.id);
    expect(results[0]!.body.data.correct).toBe(false);
    expect((await request('/statistics/overview')).body.data.total).toBe(1);
    expect(
      (await request('/wrong-questions')).body.data.some((q: { id: string }) => q.id === questionId),
    ).toBe(true);
    expect((await request('/wrong-questions', 'GET', undefined, otherToken)).body.data).toHaveLength(0);
    expect(
      (
        await request('/questions/' + questionId + '/answer', 'POST', {
          answer: ['Z'],
          seconds: 10,
          requestId: randomUUID(),
        })
      ).status,
    ).toBe(400);
    await request('/questions/' + questionId + '/favorite', 'POST');
    expect((await request('/questions?mode=favorite')).body.data).toHaveLength(1);
    await request('/questions/' + questionId + '/note', 'PATCH', { note: '用户私有笔记' });
    expect((await request('/questions/' + questionId, 'GET', undefined, otherToken)).body.data.note).toBe('');
    await request('/wrong-questions/' + questionId + '/mastered', 'PATCH', { mastered: true });
    expect((await request('/wrong-questions')).body.data).toHaveLength(0);
  });
  it('主观题隐藏参考解析、拒绝自动计分；原试卷保持范围与顺序', async () => {
    const category = await request(
      '/admin/categories',
      'POST',
      { name: `阅读题 ${suffix}`, subject: '申论' },
      adminToken,
    );
    expect(category.status).toBe(200);
    const readingCategoryId = category.body.data.id as string;
    const readingInput = {
      title: `主观阅读题 ${suffix}`,
      material: '第一则材料。\n\n第二则材料。',
      subject: '申论',
      categoryId: readingCategoryId,
      type: 'subjective',
      options: [],
      correctAnswer: [],
      explanation: '只在主动查看时显示的参考答案。',
      sourceLabel: '迁移测试来源',
      status: 'pending',
    };
    expect(
      (await request('/admin/questions', 'POST', { ...readingInput, type: 'single' }, adminToken)).status,
    ).toBe(400);
    const reading = await request('/admin/questions', 'POST', readingInput, adminToken);
    expect(reading.status).toBe(201);
    const readingId = reading.body.data.id as string;
    await pool.query('update questions set external_key=$1 where id=$2', [
      `private-bank-key:${suffix}`,
      readingId,
    ]);
    for (const auth of ['', token]) {
      const publicQuestion = await request(`/questions/${readingId}`, 'GET', undefined, auth);
      expect(publicQuestion.body.data.material).toBe(readingInput.material);
      expect(publicQuestion.body.data.type).toBe('subjective');
      expect(publicQuestion.body.data.explanation).toBeUndefined();
      expect(publicQuestion.body.data.correctAnswer).toBeUndefined();
      expect(publicQuestion.body.data.externalKey).toBeUndefined();
    }
    expect((await request(`/questions/${readingId}/solution`, 'GET', undefined, '')).status).toBe(401);
    expect((await request(`/questions/${questionId}/solution`)).status).toBe(400);
    expect((await request(`/questions/${readingId}/solution`)).body.data).toEqual({
      explanation: readingInput.explanation,
    });
    const before = (await request('/statistics/overview')).body.data;
    expect(
      (
        await request(`/questions/${readingId}/answer`, 'POST', {
          answer: ['A'],
          seconds: 10,
          requestId: randomUUID(),
        })
      ).status,
    ).toBe(400);
    const after = (await request('/statistics/overview')).body.data;
    expect({ total: after.total, correct: after.correct, wrong: after.wrong }).toEqual({
      total: before.total,
      correct: before.correct,
      wrong: before.wrong,
    });
    expect((await request(`/questions/${readingId}/history`)).body.data).toEqual([]);
    expect(
      (await request('/exams', 'POST', { count: 1, categoryId: readingCategoryId }, otherToken)).status,
    ).toBe(400);

    const objective = await request(
      '/admin/questions',
      'POST',
      {
        ...readingInput,
        title: `原卷客观题 ${suffix}`,
        type: 'single',
        options: [
          { key: 'A', text: '正确' },
          { key: 'B', text: '错误' },
        ],
        correctAnswer: ['A'],
      },
      adminToken,
    );
    expect(objective.status).toBe(201);
    const objectiveId = objective.body.data.id as string;
    expect(
      (await request('/exams', 'POST', { count: 2, categoryId: readingCategoryId }, otherToken)).status,
    ).toBe(400);
    const exam = await request(
      '/exams',
      'POST',
      { count: 1, minutes: 180, categoryId: readingCategoryId },
      otherToken,
    );
    expect(exam.status).toBe(201);
    expect(exam.body.data.questions.map((q: { id: string }) => q.id)).toEqual([objectiveId]);

    const sourceId = randomUUID(),
      paperId = randomUUID();
    await pool.query(
      "insert into content_sources(id,name,url,terms,verification,version) values($1,$2,'https://example.com','测试','pending','1')",
      [sourceId, `原卷测试 ${suffix}`],
    );
    await pool.query(
      'insert into source_papers(id,external_key,source_id,title,subject,category,year,question_count,materials,raw) values($1,$2,$3,$4,$5,$6,2026,2,$7,$8)',
      [
        paperId,
        `paper:${suffix}`,
        sourceId,
        `原卷 ${suffix}`,
        '公务员·申论',
        '测试卷',
        JSON.stringify([{ title: '材料一', text: '原卷材料正文。', pdf: '', idx: 1 }]),
        JSON.stringify({ answer: '不得通过公开目录泄露' }),
      ],
    );
    for (const [id, position] of [
      [objectiveId, 1],
      [readingId, 7],
    ] as const)
      await pool.query(
        'insert into source_paper_questions(paper_id,question_id,position,raw) values($1,$2,$3,$4)',
        [paperId, id, position, JSON.stringify({ answer: '不得通过公开目录泄露' })],
      );
    const papers = await request(
      `/question-papers?q=${encodeURIComponent(suffix)}&subject=${encodeURIComponent('公务员·申论')}&pageSize=1`,
      'GET',
      undefined,
      '',
    );
    expect(papers.status).toBe(200);
    expect(papers.body.meta).toMatchObject({ total: 1, pageSize: 1 });
    expect(papers.body.data[0].raw).toBeUndefined();
    const detail = await request(`/question-papers/${paperId}?pageSize=1`, 'GET', undefined, '');
    expect(detail.body.data.questions).toEqual([
      { id: objectiveId, title: objective.body.data.title, type: 'single', subject: '申论', position: 1 },
    ]);
    expect(detail.body.meta.total).toBe(2);
    expect(detail.body.data.raw).toBeUndefined();
    expect(JSON.stringify(detail.body)).not.toContain('不得通过公开目录泄露');
    const second = await request(`/question-papers/${paperId}?page=2&pageSize=1`, 'GET', undefined, '');
    expect(second.body.data.questions[0]).toMatchObject({ id: readingId, position: 7 });
    const scoped = await request(`/questions?paperId=${paperId}`);
    expect(scoped.body.data.map((q: { id: string }) => q.id)).toEqual([objectiveId, readingId]);
    expect(
      scoped.body.data.every(
        (q: { correctAnswer?: string[]; explanation?: string; externalKey?: string }) =>
          !('correctAnswer' in q) && !('explanation' in q) && !('externalKey' in q),
      ),
    ).toBe(true);
    expect(
      (await request(`/questions?paperId=${paperId}&after=${objectiveId}`)).body.data.map(
        (q: { id: string }) => q.id,
      ),
    ).toEqual([readingId]);
    expect((await request(`/questions?paperId=${paperId}&after=${readingId}`)).body.data).toEqual([]);
    expect((await request(`/questions?paperId=${paperId}&after=${questionId}`)).status).toBe(400);
    expect((await request(`/questions?paperId=${randomUUID()}`)).status).toBe(404);
    expect((await request(`/question-papers/${randomUUID()}`)).status).toBe(404);
    const otherPaperId = randomUUID();
    await pool.query(
      'insert into source_papers(id,external_key,source_id,title,subject,category,year,question_count,materials,raw) values($1,$2,$3,$4,$5,$6,2024,1,$7,$8)',
      [
        otherPaperId,
        `other-paper:${suffix}`,
        sourceId,
        `另一原卷 ${suffix}`,
        '公务员·申论',
        '测试卷',
        JSON.stringify([{ title: '另一卷材料', text: '只属于另一试卷的材料。', pdf: '', idx: 1 }]),
        JSON.stringify({ answer: '不得通过公开目录泄露' }),
      ],
    );
    await pool.query(
      'insert into source_paper_questions(paper_id,question_id,position,raw) values($1,$2,1,$3)',
      [otherPaperId, readingId, JSON.stringify({ answer: '不得通过公开目录泄露' })],
    );
    const firstContext = await request(`/questions/${readingId}?paperId=${paperId}`);
    const otherContext = await request(`/questions/${readingId}?paperId=${otherPaperId}`);
    expect(firstContext.body.data).toMatchObject({
      id: readingId,
      sourceLabel: `原卷 ${suffix}`,
      year: 2026,
      material: '材料一\n原卷材料正文。',
    });
    expect(otherContext.body.data).toMatchObject({
      id: readingId,
      sourceLabel: `另一原卷 ${suffix}`,
      year: 2024,
      material: '另一卷材料\n只属于另一试卷的材料。',
    });
    expect((await request(`/questions/${readingId}`)).body.data.material).toBe(readingInput.material);
    const contextualList = await request(`/questions?paperId=${otherPaperId}`);
    expect(contextualList.body.data[0]).toMatchObject({
      id: readingId,
      sourceLabel: otherContext.body.data.sourceLabel,
      year: otherContext.body.data.year,
      material: otherContext.body.data.material,
    });
    expect((await request(`/questions/${objectiveId}?paperId=${paperId}`)).body.data.material).toBe(
      readingInput.material,
    );
    expect((await request(`/questions/${objectiveId}?paperId=${otherPaperId}`)).status).toBe(404);
    expect((await request(`/questions/${readingId}?paperId=not-a-uuid`)).status).toBe(400);
    expect(JSON.stringify(otherContext.body)).not.toContain('不得通过公开目录泄露');
    for (const response of [firstContext, otherContext, contextualList]) {
      expect(JSON.stringify(response.body)).not.toContain('externalKey');
      expect(JSON.stringify(response.body)).not.toContain('explanation');
      expect(JSON.stringify(response.body)).not.toContain('correctAnswer');
      expect(JSON.stringify(response.body)).not.toContain('"raw"');
    }
  });
  it('考试答案持久化、隔离、并发交卷只评分一次', async () => {
    const e = await request('/exams', 'POST', { count: 2, minutes: 2, points: 5, title: '并发考试测试' });
    expect(e.status).toBe(201);
    examId = e.body.data.id;
    const q = e.body.data.questions[0];
    expect(q.correctAnswer).toBeUndefined();
    expect((await request('/exams/' + examId, 'GET', undefined, otherToken)).status).toBe(404);
    expect(
      (await request('/exams/' + examId + '/answers', 'PATCH', { questionId: q.id, answer: ['A'] })).status,
    ).toBe(200);
    expect((await request('/exams/' + examId)).body.data.questions[0].answer).toEqual(['A']);
    expect(
      (await request('/exams/' + examId + '/answers', 'PATCH', { questionId: randomUUID(), answer: ['A'] }))
        .status,
    ).toBe(400);
    const both = await Promise.all([
      request('/exams/' + examId + '/submit', 'POST'),
      request('/exams/' + examId + '/submit', 'POST'),
    ]);
    expect(both[0]!.body.data.score).toBe(both[1]!.body.data.score);
    expect(both[0]!.body.data.status).toBe('submitted');
    expect((await request('/statistics/overview')).body.data.total).toBe(3);
    expect((await request('/exams/' + examId + '/result')).status).toBe(200);
    expect(
      (await request('/exams/' + examId + '/answers', 'PATCH', { questionId: q.id, answer: ['B'] })).status,
    ).toBe(409);
  });
  it('服务端截止后拒绝新答案并自动交卷', async () => {
    const e = await request('/exams', 'POST', { count: 1, minutes: 1 });
    const id = e.body.data.id;
    await pool.query(
      "update exam_attempts set deadline=now()-interval '1 second',started_at=now()-interval '1 minute' where id=$1",
      [id],
    );
    expect(
      (
        await request('/exams/' + id + '/answers', 'PATCH', {
          questionId: e.body.data.questions[0].id,
          answer: ['A'],
        })
      ).status,
    ).toBe(409);
    expect((await request('/exams/' + id + '/result')).body.data.status).toBe('submitted');
  });
  it('岗位查询、收藏、三态匹配、公告收藏', async () => {
    const j = await request('/jobs?province=浙江&education=本科');
    expect(j.status).toBe(200);
    expect(j.body.data.length).toBeGreaterThan(0);
    jobId = j.body.data[0].id;
    await request('/jobs/' + jobId + '/favorite', 'POST');
    expect((await request('/jobs/favorites')).body.data[0].id).toBe(jobId);
    expect((await request('/jobs/match', 'POST', { jobIds: [jobId] })).body.data[0].status).toBe(
      '需要人工确认',
    );
    const a = await request('/announcements');
    announcementId = a.body.data[0].id;
    await request('/announcements/' + announcementId + '/favorite', 'POST');
    expect((await request('/announcements?favorite=true')).body.data[0].id).toBe(announcementId);
    expect((await request('/announcements/' + announcementId)).body.data.sourceUrl).toMatch(/^https:/);
  });
  it('导入失败整批回滚、重复检查、错误导出及有效岗位导入', async () => {
    const base = {
      title: '导入测试 ' + suffix,
      subject: '数量关系',
      categoryId,
      options: [
        { key: 'A', text: '1' },
        { key: 'B', text: '2' },
      ],
      correctAnswer: ['A'],
      explanation: '原创',
      sourceLabel: '测试',
      status: 'demo',
    };
    const bad = await request(
      '/admin/imports',
      'POST',
      { kind: 'questions', rows: [base, { ...base, title: '坏行', categoryId: randomUUID() }] },
      adminToken,
    );
    expect(bad.status).toBe(400);
    expect(bad.body.data.imported).toBe(0);
    expect((await request('/questions?q=' + encodeURIComponent(base.title))).body.data).toHaveLength(0);
    const good = await request('/admin/imports', 'POST', { kind: 'questions', rows: [base] }, adminToken);
    expect(good.status).toBe(201);
    expect(
      (await request('/admin/imports', 'POST', { kind: 'questions', rows: [base] }, adminToken)).status,
    ).toBe(400);
    const exportResponse = await app.request('/api/v1/admin/imports/' + bad.body.data.id + '/errors', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    expect(exportResponse.status).toBe(200);
    expect(await exportResponse.text()).toContain('数据库约束');
    const j = await request(
      '/admin/imports',
      'POST',
      {
        kind: 'jobs',
        rows: [
          {
            year: 2027,
            examType: '省考',
            province: '浙江',
            organization: '测试单位',
            title: '导入测试岗位',
            code: suffix,
            headcount: 1,
            sourceUrl: 'https://example.com',
            sourceLabel: '原创演示',
            publishedAt: new Date().toISOString(),
            status: 'demo',
          },
        ],
      },
      adminToken,
    );
    expect(j.status).toBe(201);
    expect(
      (await request('/admin/audit-logs', 'GET', undefined, adminToken)).body.data.length,
    ).toBeGreaterThan(0);
  });
  it('并发创建考试限制为五场，访问统计时结算离线超时考试', async () => {
    const results = await Promise.all(
      Array.from({ length: 7 }, () => request('/exams', 'POST', { count: 1, minutes: 1 })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    await pool.query(
      "update exam_attempts set deadline=now()-interval '1 second' where user_id=$1 and status='active'",
      [userId],
    );
    expect((await request('/statistics/overview')).status).toBe(200);
    const active = await pool.query(
      "select count(*)::int as n from exam_attempts where user_id=$1 and status='active'",
      [userId],
    );
    expect(active.rows[0].n).toBe(0);
  });
  it('CSV / Excel 文件导入与导出保持结构化字段，导出需要管理员', async () => {
    const XLSX = await import('xlsx');
    for (const format of ['csv', 'xlsx'] as const) {
      const row = {
        title: `${format}-${suffix}`,
        subject: '数量关系',
        categoryId,
        options: JSON.stringify([
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
        ]),
        correctAnswer: JSON.stringify(['A']),
        explanation: '原创文件导入测试',
        sourceLabel: '原创测试',
        status: 'demo',
        tags: JSON.stringify(['导入测试']),
      };
      const sheet = XLSX.utils.json_to_sheet([row]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, '数据');
      const bytes =
        format === 'xlsx'
          ? XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
          : XLSX.utils.sheet_to_csv(sheet);
      const form = new FormData();
      form.set('kind', 'questions');
      form.set('file', new File([bytes], 'test.' + format));
      const imported = await app.request('/api/v1/admin/imports', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + adminToken },
        body: form,
      });
      expect(imported.status).toBe(201);
      const lookup = await request('/questions?q=' + encodeURIComponent(row.title));
      expect(lookup.body.data[0].tags).toEqual(['导入测试']);
      const url = '/api/v1/admin/exports/questions?format=' + format + '&pageSize=1';
      expect((await app.request(url, { headers: { Authorization: 'Bearer ' + token } })).status).toBe(403);
      const exported = await app.request(url, { headers: { Authorization: 'Bearer ' + adminToken } });
      expect(exported.status).toBe(200);
      const parsed = XLSX.read(Buffer.from(await exported.arrayBuffer()), { type: 'buffer' });
      expect(XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]!]!)).toHaveLength(1);
    }
  });
  it('修改密码会撤销所有设备会话', async () => {
    const email = `password-${suffix}@example.com`,
      password = 'password-change-old-123';
    const registered = await request('/auth/register', 'POST', { email, password, client: 'mobile' }, '');
    const access = registered.body.data.accessToken;
    expect(
      (
        await request(
          '/users/me/password',
          'PATCH',
          { currentPassword: password, newPassword: 'password-change-new-123' },
          access,
        )
      ).status,
    ).toBe(200);
    expect((await request('/users/me', 'GET', undefined, access)).status).toBe(401);
    expect((await request('/auth/login', 'POST', { email, password, client: 'mobile' }, '')).status).toBe(
      401,
    );
    const login = await request(
      '/auth/login',
      'POST',
      { email, password: 'password-change-new-123', client: 'mobile' },
      '',
    );
    expect(login.status).toBe(200);
    // An expired/missing access token must not prevent mobile refresh-session revocation.
    expect(
      (
        await request(
          '/auth/logout',
          'POST',
          { client: 'mobile', refreshToken: login.body.data.refreshToken },
          '',
        )
      ).status,
    ).toBe(200);
    expect((await request('/users/me', 'GET', undefined, login.body.data.accessToken)).status).toBe(401);
  });
  it('分级题库按用户显示进度并在错题续练中保留范围', async () => {
    async function createCategory(label: string, parentId: string | null = null) {
      const response = await request(
        '/admin/categories',
        'POST',
        { name: `${label}-${suffix}`, subject: '数量关系', parentId },
        adminToken,
      );
      expect(response.status).toBe(200);
      return response.body.data.id as string;
    }
    async function createQuestion(label: string, categoryId: string) {
      const response = await request(
        '/admin/questions',
        'POST',
        {
          title: `${label}-${suffix}`,
          subject: '数量关系',
          categoryId,
          options: [
            { key: 'A', text: '1' },
            { key: 'B', text: '2' },
          ],
          correctAnswer: ['A'],
          explanation: '原创测试解析',
          sourceLabel: '原创测试',
          status: 'demo',
        },
        adminToken,
      );
      expect(response.status).toBe(201);
      return response.body.data.id as string;
    }
    async function answer(id: string, option: string, requestId = randomUUID()) {
      const response = await request(`/questions/${id}/answer`, 'POST', {
        answer: [option],
        seconds: 2,
        requestId,
      });
      expect(response.status).toBe(200);
      return response.body.data.id as string;
    }
    const root = await createCategory('专题');
    const child = await createCategory('章节', root);
    const leaf = await createCategory('知识点', child);
    const rootQuestion = await createQuestion('专题练习', root);
    const olderQuestion = await createQuestion('早期练习', child);
    const newerQuestion = await createQuestion('上次练习', leaf);
    const disabledQuestion = await createQuestion('停用练习', leaf);
    await answer(rootQuestion, 'B');
    await answer(olderQuestion, 'B');
    await answer(newerQuestion, 'B');
    const repeatId = randomUUID();
    expect(await answer(newerQuestion, 'A', repeatId)).toBe(await answer(newerQuestion, 'A', repeatId));
    await answer(disabledQuestion, 'B');
    for (const id of [olderQuestion, newerQuestion, disabledQuestion])
      expect((await request(`/wrong-questions/${id}/mastered`, 'PATCH', { mastered: true })).status).toBe(
        200,
      );
    expect(
      (await request(`/admin/questions/${disabledQuestion}`, 'DELETE', undefined, adminToken)).status,
    ).toBe(200);
    await pool.query('update user_question_states set updated_at=$1 where user_id=$2 and question_id=$3', [
      '2000-01-01T00:00:00.000Z',
      userId,
      olderQuestion,
    ]);

    expect((await request('/question-categories/progress', 'GET', undefined, '')).status).toBe(401);
    const progress = await request('/question-categories/progress');
    expect(progress.status).toBe(200);
    expect(progress.body.meta).toBeUndefined();
    expect(progress.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: root,
          parentId: null,
          count: 1,
          attempted: 1,
          attempts: 1,
          correctAttempts: 0,
        }),
        expect.objectContaining({
          id: leaf,
          parentId: child,
          count: 1,
          attempted: 1,
          attempts: 2,
          correctAttempts: 1,
        }),
      ]),
    );
    const other = await request('/question-categories/progress', 'GET', undefined, otherToken);
    expect(other.body.data).toContainEqual(
      expect.objectContaining({ id: leaf, count: 1, attempted: 0, attempts: 0, correctAttempts: 0 }),
    );
    const publicCategories = await request('/question-categories', 'GET', undefined, '');
    expect(
      publicCategories.body.data.find((row: { id: string }) => row.id === leaf).attempts,
    ).toBeUndefined();

    const exact = await request(`/questions?categoryId=${root}&includeDescendants=false`);
    expect(exact.body.data.map((q: { id: string }) => q.id)).toEqual([rootQuestion]);
    const subtree = await request(`/questions?categoryId=${root}&includeDescendants=true`);
    expect(subtree.body.data.map((q: { id: string }) => q.id)).toEqual([
      rootQuestion,
      olderQuestion,
      newerQuestion,
    ]);
    expect(subtree.body.meta.total).toBe(3);
    expect((await request(`/questions?categoryId=${root}&includeDescendants=1`)).status).toBe(400);

    const scope = `categoryId=${root}&includeDescendants=true&mastered=true&since=2020-01-01T00:00:00.000Z`;
    const wrongList = await request(`/wrong-questions?${scope}&sort=recent`);
    expect(wrongList.body.data.map((q: { id: string }) => q.id)).toEqual([newerQuestion]);
    const next = await request(`/questions?mode=wrong&${scope}&after=${rootQuestion}&pageSize=1`);
    expect(next.body.data.map((q: { id: string }) => q.id)).toEqual([newerQuestion]);
    const empty = await request(`/questions?mode=wrong&${scope}`, 'GET', undefined, otherToken);
    expect(empty.body.data).toEqual([]);
  });
  const settingsKey = 'mock-ai-secret-for-integration';
  function saveAiSettings(
    baseUrl: string,
    { enabled = true, apiKey }: { enabled?: boolean; apiKey?: string | null } = {},
  ) {
    return request(
      '/ai/settings',
      'PATCH',
      { enabled, baseUrl, model: 'integration-model', tokenLimitField: 'max_tokens', apiKey },
      adminToken,
    );
  }
  it('AI 网关配置由管理员保存，切换地址和重定向均不转发旧密钥', async () => {
    [primaryGateway, secondaryGateway] = await Promise.all([createAiGateway(), createAiGateway()]);
    primaryGateway.respond('连接可用');
    secondaryGateway.respond('第二网关可用');
    const disabled = await saveAiSettings(primaryGateway.url, { enabled: false, apiKey: null });
    expect(disabled.status).toBe(200);
    expect((await request('/ai/status')).body.data).toEqual({ enabled: false });
    expect((await request('/ai/study-advice', 'POST')).status).toBe(503);
    expect((await request('/ai/settings', 'GET', undefined, '')).status).toBe(401);
    expect((await request('/ai/settings')).status).toBe(403);
    expect((await request('/ai/settings', 'PATCH', { enabled: false })).status).toBe(403);
    expect((await request('/ai/settings/test', 'POST')).status).toBe(403);
    expect(primaryGateway.calls).toHaveLength(0);

    const saved = await saveAiSettings(primaryGateway.url, { apiKey: settingsKey });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({
      enabled: true,
      baseUrl: primaryGateway.url,
      model: 'integration-model',
      tokenLimitField: 'max_tokens',
      hasApiKey: true,
      source: 'database',
    });
    const read = await request('/ai/settings', 'GET', undefined, adminToken);
    expect(read.body.data).toEqual(saved.body.data);
    expect(JSON.stringify({ saved: saved.body, read: read.body })).not.toContain(settingsKey);
    const { rows } = await pool.query<{ encrypted_api_key: string }>(
      'select encrypted_api_key from ai_settings where id = 1',
    );
    expect(rows[0]?.encrypted_api_key).toBeTruthy();
    expect(rows[0]?.encrypted_api_key).not.toContain(settingsKey);
    expect((await saveAiSettings(primaryGateway.url)).body.data.hasApiKey).toBe(true);
    expect((await request('/ai/status')).body.data).toEqual({ enabled: true });
    const ping = await request('/ai/settings/test', 'POST', undefined, adminToken);
    expect(ping.status).toBe(200);
    expect(ping.body.data).toEqual({ ok: true });
    const firstCall = primaryGateway.calls.at(-1)!;
    expect(firstCall).toMatchObject({
      path: '/relay/v1/chat/completions',
      method: 'POST',
      auth: `Bearer ${settingsKey}`,
    });
    expect(JSON.parse(firstCall.body)).toMatchObject({
      model: 'integration-model',
      max_tokens: expect.any(Number),
    });
    expect(firstCall.body).not.toContain(settingsKey);

    const secondaryEndpoint = `${secondaryGateway.url}/chat/completions`;
    primaryGateway.fail(307, { error: 'redirect' }, secondaryEndpoint);
    const redirect = await request('/ai/settings/test', 'POST', undefined, adminToken);
    expect(redirect.status).toBe(502);
    expect(secondaryGateway.calls).toHaveLength(0);
    primaryGateway.fail(500, { error: { message: `仅上游可见 ${settingsKey}` } });
    const upstream = await request('/ai/settings/test', 'POST', undefined, adminToken);
    expect(upstream.status).toBe(502);
    expect(JSON.stringify(upstream.body)).not.toMatch(/仅上游可见|mock-ai-secret-for-integration/);

    const changed = await saveAiSettings(secondaryEndpoint);
    expect(changed.status).toBe(200);
    expect(changed.body.data.hasApiKey).toBe(false);
    expect((await request('/ai/settings/test', 'POST', undefined, adminToken)).status).toBe(200);
    expect(secondaryGateway.calls.at(-1)).toMatchObject({
      path: '/relay/v1/chat/completions',
      auth: undefined,
    });
    primaryGateway.respond('连接可用');
    expect((await saveAiSettings(primaryGateway.url, { apiKey: settingsKey })).status).toBe(200);
  });
  it('AI 解析验证作答归属，学习建议只发送当前用户的统计汇总', async () => {
    const history = await request(`/questions/${questionId}/history`);
    const answerId = history.body.data[0].id as string;
    const input = { questionId, answerId };
    const previousCount = primaryGateway.calls.length;
    expect((await request('/ai/question-explanation', 'POST', input, '')).status).toBe(401);
    expect((await request('/ai/question-explanation', 'POST', input, otherToken)).status).toBe(404);
    expect(
      (await request('/ai/question-explanation', 'POST', { questionId, answerId: randomUUID() })).status,
    ).toBe(404);
    expect((await request('/ai/study-advice', 'POST', undefined, otherToken)).status).toBe(409);
    expect(primaryGateway.calls).toHaveLength(previousCount);

    primaryGateway.respond('## 解题思路\n逐项排除可得答案。');
    const explanation = await request('/ai/question-explanation', 'POST', input);
    expect(explanation.status).toBe(200);
    expect(explanation.body.data.text).toContain('逐项排除');
    const explanationPrompt = JSON.parse(primaryGateway.calls.at(-1)!.body).messages.at(-1).content as string;
    expect(explanationPrompt).toContain(`集成测试 ${suffix}`);
    expect(explanationPrompt).toContain('测试用解析');
    for (const privateValue of [userId, answerId, questionId, '@example.com', '用户私有笔记'])
      expect(explanationPrompt).not.toContain(privateValue);

    primaryGateway.respond('## 本周计划\n复盘数量关系。');
    const advice = await request('/ai/study-advice', 'POST');
    expect(advice.status).toBe(200);
    expect(advice.body.data.text).toContain('复盘数量关系');
    const advicePrompt = JSON.parse(primaryGateway.calls.at(-1)!.body).messages.at(-1).content as string;
    const aggregates = JSON.parse(advicePrompt);
    expect(Object.keys(aggregates).sort()).toEqual(['主要科目统计', '日期统计']);
    expect(aggregates.日期统计).toEqual(
      expect.arrayContaining([
        {
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          total: expect.any(Number),
          correct: expect.any(Number),
        },
      ]),
    );
    expect(aggregates.主要科目统计).toEqual(
      expect.arrayContaining([
        { subject: '数量关系', total: expect.any(Number), correct: expect.any(Number) },
      ]),
    );
    const privateValues = [
      userId,
      answerId,
      questionId,
      '@example.com',
      '用户私有笔记',
      suffix,
      '测试用解析',
    ];
    for (const privateValue of privateValues) expect(advicePrompt).not.toContain(privateValue);

    await pool.query('update questions set updated_at = now() where id = $1', [questionId]);
    const edited = await request('/ai/question-explanation', 'POST', input);
    expect(edited.status).toBe(409);
    expect(primaryGateway.calls).toHaveLength(previousCount + 2);
  });
  it('AI 导题限制管理员并保留人工指定的来源、分类和停用状态', async () => {
    const draftTitle = `AI 草稿 ${suffix}`;
    const payload = {
      text: '这是要整理的完整题库原文。',
      categoryId,
      sourceLabel: '人工确认来源',
    };
    const previousCount = primaryGateway.calls.length;
    expect((await request('/ai/question-drafts', 'POST', payload)).status).toBe(403);
    const invalidCategory = await request(
      '/ai/question-drafts',
      'POST',
      { ...payload, categoryId: randomUUID() },
      adminToken,
    );
    expect(invalidCategory.status).toBe(404);
    expect(primaryGateway.calls).toHaveLength(previousCount);

    const generated = {
      title: draftTitle,
      type: 'single',
      options: [
        { key: 'A', text: '是' },
        { key: 'B', text: '否' },
      ],
      correctAnswer: ['A'],
      explanation: '这是草稿解析。',
      categoryId: randomUUID(),
      sourceLabel: '模型自选来源',
      status: 'verified',
      enabled: true,
    };
    primaryGateway.respond(JSON.stringify([generated]));
    const drafted = await request('/ai/question-drafts', 'POST', payload, adminToken);
    expect(drafted.status).toBe(200);
    expect(drafted.body.data).toEqual([
      expect.objectContaining({
        title: draftTitle,
        categoryId,
        sourceLabel: '人工确认来源',
        enabled: false,
        status: 'pending',
      }),
    ]);
    const draftPrompt = JSON.parse(primaryGateway.calls.at(-1)!.body).messages.at(-1).content as string;
    expect(draftPrompt).toContain(payload.text);
    expect(draftPrompt).not.toContain(payload.categoryId);
    expect(draftPrompt).not.toContain(payload.sourceLabel);
    const persisted = await pool.query('select id from questions where title = $1', [draftTitle]);
    expect(persisted.rows).toHaveLength(0);

    primaryGateway.respond(JSON.stringify([{ ...generated, correctAnswer: ['C'] }]));
    expect((await request('/ai/question-drafts', 'POST', payload, adminToken)).status).toBe(502);
    const cleared = await saveAiSettings(primaryGateway.url, { enabled: false, apiKey: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.hasApiKey).toBe(false);
    expect((await request('/ai/status')).body.data).toEqual({ enabled: false });
  });
  it('刷新令牌轮换，旧令牌重放撤销会话', async () => {
    const next = await request('/auth/refresh', 'POST', { client: 'mobile', refreshToken: refresh }, '');
    expect(next.status).toBe(200);
    const newToken = next.body.data.accessToken;
    expect((await request('/users/me', 'GET', undefined, newToken)).status).toBe(200);
    expect(
      (await request('/auth/refresh', 'POST', { client: 'mobile', refreshToken: refresh }, '')).status,
    ).toBe(401);
    expect((await request('/users/me', 'GET', undefined, newToken)).status).toBe(401);
  });
  it('禁用用户立即阻断已有 token', async () => {
    expect((await request('/admin/users/' + userId, 'PATCH', { active: false }, adminToken)).status).toBe(
      200,
    );
    expect((await request('/users/me', 'GET', undefined, token)).status).toBe(401);
  });
});
