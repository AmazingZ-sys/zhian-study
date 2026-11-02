import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Env } from '../src/lib';
const enabled = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!enabled)('真实 PostgreSQL API 集成', () => {
  let app: Hono<Env>, pool: (typeof import('../src/db/index'))['pool'];
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
    ({ app } = await import('../src/app'));
    ({ pool } = await import('../src/db/index'));
  });
  afterAll(async () => {
    await pool?.end();
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
    const login = await request('/auth/login','POST',{email,password:'password-change-new-123',client:'mobile'},'');
    expect(login.status).toBe(200);
    // An expired/missing access token must not prevent mobile refresh-session revocation.
    expect((await request('/auth/logout','POST',{client:'mobile',refreshToken:login.body.data.refreshToken},'')).status).toBe(200);
    expect((await request('/users/me','GET',undefined,login.body.data.accessToken)).status).toBe(401);
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
