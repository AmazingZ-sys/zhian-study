import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = apiRequire('pg') as typeof import('../apps/api/node_modules/@types/pg');
const password = 'e2e-local-password-123';
test('注册登录 → 错题收藏 → 模考报告 → 岗位公告 → 移动端', async ({ page }) => {
  const faults: string[] = [];
  page.on('pageerror', (e) => faults.push(e.message));
  await page.route('**/api/v1/ai/status', (route) => route.fulfill({ json: { data: { enabled: true } } }));
  const explanationRequests: unknown[] = [];
  await page.route('**/api/v1/ai/question-explanation', (route) => {
    explanationRequests.push(route.request().postDataJSON());
    return explanationRequests.length === 1
      ? route.fulfill({ status: 502, json: { error: { message: '测试网关暂时不可用' } } })
      : route.fulfill({
          json: { data: { text: '**测试讲解**\n\n<script>window.__aiShouldNeverRun = true</script>' } },
        });
  });
  let adviceRequests = 0;
  await page.route('**/api/v1/ai/study-advice', (route) => {
    adviceRequests++;
    return route.fulfill({ json: { data: { text: '先复盘已错的常识判断题。' } } });
  });
  const email = `e2e-${randomUUID()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('昵称', { exact: true }).fill('浏览器验收');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账户', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('累计答题', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL('/login');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录知岸', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/practice');
  await expect(page.locator('.list-card').first()).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  const chapter = page.getByRole('button', { name: '日常科学', exact: true });
  await chapter.click();
  await expect(chapter).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/categoryId=/);
  await expect(page.getByLabel('题目关键词')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('题目关键词').fill('水在标准大气压');
  await page.getByRole('button', { name: '筛选题目' }).click();
  await expect(page.locator('.list-card')).toHaveCount(1);
  const filteredPractice = page.url();
  await page.getByRole('link', { name: '开始练习', exact: true }).first().click();
  await expect(page.locator('.question-stem')).toContainText('沸点');
  await expect(page.getByRole('button', { name: '生成 AI 解析' })).toHaveCount(0);
  await page.getByRole('button', { name: 'A 0℃', exact: true }).click();
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await expect(page.getByText('这次没选对，把思路弄明白。')).toBeVisible();
  expect(explanationRequests).toHaveLength(0);
  const explanation = page.getByRole('region', { name: 'AI 解析' });
  await explanation.getByRole('button', { name: '生成 AI 解析' }).click();
  await expect(explanation.getByRole('alert')).toContainText('测试网关暂时不可用');
  await expect(page.locator('.answer-analysis').getByText('标准大气压下，纯水的沸点为 100℃。')).toBeVisible();
  await explanation.getByRole('button', { name: '生成 AI 解析' }).click();
  await expect(explanation.getByText('测试讲解')).toBeVisible();
  expect(explanationRequests).toHaveLength(2);
  expect(explanationRequests[0]).toEqual({ questionId: expect.any(String), answerId: expect.any(String) });
  expect(explanationRequests[1]).toEqual(explanationRequests[0]);
  await expect(explanation.locator('script')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__aiShouldNeverRun'))).toBeUndefined();
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.getByRole('button', { name: '已收藏', exact: true })).toBeVisible();
  await page.getByLabel('个人笔记').fill('沸点需要明确大气压条件');
  const [noteResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        /\/questions\/[^/]+\/note$/.test(new URL(response.url()).pathname),
    ),
    page.getByRole('button', { name: '保存笔记', exact: true }).click(),
  ]);
  expect(noteResponse.ok()).toBe(true);
  await expect(page.getByRole('button', { name: '笔记已保存', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('个人笔记')).toHaveValue('沸点需要明确大气压条件');
  await expect(page.getByText('错误 ·', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: '返回刷题中心' }).click();
  await expect(page).toHaveURL(filteredPractice);
  await expect(page.getByLabel('题目关键词')).toHaveValue('水在标准大气压');
  await expect(chapter).toContainText(/已练 1 \/ \d+ 题/);
  await expect(chapter).toContainText('正确率 0%');
  await page.goto('/wrong');
  await expect(page.locator('.list-card')).toContainText('沸点');
  await page.getByRole('button', { name: '标记已掌握' }).click();
  await expect(page.getByText('当前范围没有错题')).toBeVisible();
  await page.getByLabel('掌握状态').selectOption('true');
  await page.getByLabel('排序').selectOption('recent');
  await page.getByLabel('更新时间起').fill('2000-01-01');
  await page.getByRole('button', { name: '筛选题目' }).click();
  await expect(page.locator('.list-card')).toContainText('沸点');
  const filteredWrong = page.url();
  await page.getByRole('link', { name: '再练一次' }).click();
  await page.getByRole('button', { name: 'C 100℃', exact: true }).click();
  await page.getByRole('button', { name: '提交答案' }).click();
  const nextRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/questions') && url.searchParams.has('after');
  });
  await page.getByRole('button', { name: '下一题' }).click();
  const nextParams = new URL((await nextRequest).url()).searchParams;
  expect(nextParams.get('mode')).toBe('wrong');
  expect(nextParams.get('mastered')).toBe('true');
  expect(nextParams.get('since')).toBe('2000-01-01T00:00:00.000Z');
  await expect(page.getByText('当前范围已没有下一题。')).toBeVisible();
  await page.getByRole('link', { name: '返回错题复盘' }).click();
  await expect(page).toHaveURL(filteredWrong);
  await expect(page.getByLabel('掌握状态')).toHaveValue('true');
  await expect(page.getByLabel('排序')).toHaveValue('recent');
  await page.goto('/favorites');
  await expect(page.locator('.list-card')).toContainText('沸点');
  const chapterOnly = new URL(filteredPractice);
  chapterOnly.searchParams.delete('q');
  await page.goto(chapterOnly.href);
  const chapterQuestions = page.getByRole('link', { name: '开始练习', exact: true });
  const nextHref = await chapterQuestions.nth(1).getAttribute('href');
  expect(nextHref).toBeTruthy();
  await chapterQuestions.first().click();
  await page.getByRole('group', { name: '选择答案' }).getByRole('button').first().click();
  await page.getByRole('button', { name: '提交答案' }).click();
  await page.getByRole('button', { name: '下一题' }).click();
  await expect(page).toHaveURL(nextHref!);
  await expect(page.getByRole('button', { name: '提交答案' })).toBeDisabled();
  await page.goto('/exams');
  await page.getByRole('button', { name: '创建模拟考试' }).click();
  await page.getByLabel('题目数量', { exact: true }).fill('2');
  await page.getByLabel('考试时长（分钟）').fill('5');
  await page.getByRole('button', { name: '开始考试', exact: true }).click();
  await expect(page.locator('.question-stem')).toBeVisible();
  await page.locator('.option').first().click();
  await expect(page.getByText('所有已选答案均已保存')).toBeVisible();
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await page.locator('.option').first().click();
  await expect(page.getByText('所有已选答案均已保存')).toBeVisible();
  await page.getByRole('button', { name: '提交试卷', exact: true }).click();
  await page.getByRole('button', { name: '确认交卷', exact: true }).click();
  await expect(page).toHaveURL(/\/result$/);
  await expect(page.getByText('YOUR EXAM REPORT')).toBeVisible();
  await page.goto('/statistics');
  await expect(page.getByRole('heading', { name: '近 30 天学习趋势' })).toBeVisible();
  expect(adviceRequests).toBe(0);
  const advice = page.getByRole('region', { name: 'AI 学习建议' });
  await advice.getByRole('button', { name: '生成学习建议' }).click();
  await expect(advice.getByText('先复盘已错的常识判断题。')).toBeVisible();
  expect(adviceRequests).toBe(1);
  await page.goto('/jobs');
  await page.getByLabel('省份', { exact: true }).fill('浙江');
  await page.getByLabel('搜索岗位', { exact: true }).fill('示例公共服务中心');
  await page.getByRole('button', { name: '查找岗位' }).click();
  await expect(page.locator('.list-card')).toHaveCount(1);
  await expect(page.locator('.list-card')).toContainText('综合管理岗');
  await page.getByRole('link', { name: '查看详情' }).first().click();
  await page.getByRole('button', { name: '收藏岗位', exact: true }).click();
  await expect(page.getByRole('button', { name: '已收藏', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '检查我的报考条件' }).click();
  await expect(page.getByText('匹配结果：需要人工确认')).toBeVisible();
  await page.goto('/jobs/favorites');
  await expect(page.locator('.list-card')).toContainText('综合管理岗');
  await page.goto('/announcements');
  await page
    .locator('.list-card')
    .filter({ hasText: '使用指南' })
    .getByRole('link', { name: '阅读全文' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('使用指南');
  await page.getByRole('button', { name: '收藏公告' }).click();
  await expect(page.getByRole('button', { name: '已收藏', exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('累计答题', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  expect(faults).toEqual([]);
});
test('管理员通过浏览器事务导入题目与岗位', async ({ page }) => {
  const email = `e2e-admin-${randomUUID()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('昵称', { exact: true }).fill('导入验收');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账户', exact: true }).click();
  await expect(page).toHaveURL('/');
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://zhian:local-development-only@localhost:5438/zhian';
  const pool = new Pool({ connectionString });
  let category: string;
  try {
    await pool.query("update users set role='admin' where email=$1", [email]);
    const r = await pool.query('select id from question_categories limit 1');
    category = String(r.rows[0].id);
  } finally {
    await pool.end();
  }

  const mockModel = 'e2e-model';
  const mockBaseUrl = 'https://gateway.example.com/relay/v1';
  const mockKey = 'e2e-test-key';
  let savedSettings = {
    enabled: false,
    baseUrl: '',
    model: '',
    tokenLimitField: 'max_completion_tokens',
    hasApiKey: false,
    source: 'none',
  };
  const patchRequests: unknown[] = [];
  let testConnections = 0;
  await page.route('**/api/v1/ai/settings', (route) => {
    if (route.request().method() === 'PATCH') {
      patchRequests.push(route.request().postDataJSON());
      savedSettings = {
        enabled: true,
        baseUrl: mockBaseUrl,
        model: mockModel,
        tokenLimitField: 'max_tokens',
        hasApiKey: true,
        source: 'database',
      };
    }
    return route.fulfill({ json: { data: savedSettings } });
  });
  await page.route('**/api/v1/ai/settings/test', (route) => {
    testConnections++;
    return route.fulfill({ json: { data: { ok: true } } });
  });
  await page.goto('/admin/ai');
  await expect(page.getByRole('heading', { name: 'AI 设置' })).toBeVisible();
  await page.getByLabel('启用 AI 功能').check();
  await page.getByLabel('中转站地址').fill(mockBaseUrl);
  await page.getByLabel('模型名').fill(mockModel);
  await page.getByLabel('API Key', { exact: true }).fill(mockKey);
  await page.getByLabel('输出长度参数').selectOption('max_tokens');
  const saveResponse = page.waitForResponse(
    (response) => response.url().endsWith('/ai/settings') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '保存配置' }).click();
  expect((await saveResponse).ok()).toBe(true);
  expect(patchRequests).toEqual([
    { enabled: true, baseUrl: mockBaseUrl, model: mockModel, tokenLimitField: 'max_tokens', apiKey: mockKey },
  ]);
  await expect(page.getByText('AI 配置已保存')).toBeVisible();
  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText('AI 网关连接成功')).toBeVisible();
  expect(testConnections).toBe(1);
  await page.reload();
  await expect(page.getByLabel('模型名')).toHaveValue(mockModel);
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');

  await page.route('**/api/v1/ai/status', (route) => route.fulfill({ json: { data: { enabled: true } } }));
  await page.goto('/admin/imports');
  await expect(page.getByRole('heading', { name: '校验并导入数据' })).toBeVisible();
  async function submitImport() {
    const result = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/admin/imports'),
    );
    await page.getByRole('button', { name: '校验并导入', exact: true }).click();
    const response = await result;
    expect(response.ok()).toBe(true);
    expect((await response.json()).data.imported).toBe(1);
    await expect(page.getByText('导入成功 · 已导入 1 行')).toBeVisible();
  }

  const q = {
    title: 'E2E 原创题 ' + randomUUID(),
    subject: '数量关系',
    categoryId: category!,
    options: [
      { key: 'A', text: '1' },
      { key: 'B', text: '2' },
    ],
    correctAnswer: ['A'],
    explanation: '原创验收题解析',
    sourceLabel: 'E2E 测试数据',
    status: 'demo',
  };
  const draft = { ...q, title: `AI 草稿 ${randomUUID()}`, status: 'pending', enabled: false };
  const draftJson = JSON.stringify([draft], null, 2);
  const draftRequests: unknown[] = [];
  let importRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/admin/imports')) importRequests++;
  });
  await page.route('**/api/v1/ai/question-drafts', (route) => {
    draftRequests.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: [draft] } });
  });
  await page.getByText('AI 整理题目原文', { exact: true }).click();
  await page.getByLabel('题目原文').fill('题干和两个选项的导入原文。');
  await page.getByLabel('草稿分类').selectOption(category!);
  await page.getByLabel('草稿来源').fill('E2E 测试数据');
  await page.getByRole('button', { name: '生成题目草稿' }).click();
  const preview = page.getByLabel('AI 题目草稿');
  await expect(preview).toHaveValue(draftJson);
  await expect(preview).toHaveJSProperty('readOnly', true);
  expect(draftRequests).toEqual([
    { text: '题干和两个选项的导入原文。', categoryId: category!, sourceLabel: 'E2E 测试数据' },
  ]);
  const importInput = page.getByLabel('导入 JSON 数组');
  await expect(importInput).toHaveValue('[]');
  await page.getByRole('button', { name: '追加到导入 JSON' }).click();
  await expect(importInput).toHaveValue(draftJson);
  expect(importRequests).toBe(0);
  await submitImport();
  const verificationPool = new Pool({ connectionString });
  try {
    const saved = await verificationPool.query('select status, enabled from questions where title = $1', [
      draft.title,
    ]);
    expect(saved.rows).toEqual([{ status: 'pending', enabled: false }]);
  } finally {
    await verificationPool.end();
  }
  await importInput.fill(JSON.stringify([q]));
  await submitImport();
  await page.getByLabel('数据类型', { exact: true }).selectOption('jobs');
  const j = {
    year: 2027,
    examType: '省考',
    province: '浙江',
    organization: 'E2E 示例单位',
    title: 'E2E 示例岗位',
    code: randomUUID(),
    headcount: 1,
    sourceUrl: 'https://example.com',
    sourceLabel: 'E2E 演示数据',
    publishedAt: new Date().toISOString(),
    status: 'demo',
  };
  await importInput.fill(JSON.stringify([j]));
  await submitImport();
});
