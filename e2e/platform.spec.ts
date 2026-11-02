import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = apiRequire('pg') as typeof import('../apps/api/node_modules/@types/pg');
const password = 'e2e-local-password-123';
test('注册登录 → 错题收藏 → 模考报告 → 岗位公告 → 移动端', async ({ page }) => {
  const faults: string[] = [];
  page.on('pageerror', (e) => faults.push(e.message));
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
  await page.getByLabel('题目关键词').fill('水在标准大气压');
  await page.getByRole('button', { name: '筛选题目' }).click();
  await expect(page.locator('.list-card')).toHaveCount(1);
  await page.getByRole('link', { name: '开始练习', exact: true }).first().click();
  await expect(page.locator('.question-stem')).toContainText('沸点');
  await page.getByRole('button', { name: 'A 0℃', exact: true }).click();
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await expect(page.getByText('这次没选对，把思路弄明白。')).toBeVisible();
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
  await page.goto('/wrong');
  await expect(page.locator('.list-card')).toContainText('沸点');
  await page.goto('/favorites');
  await expect(page.locator('.list-card')).toContainText('沸点');
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
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://zhian:local-development-only@localhost:5438/zhian',
  });
  let category: string;
  try {
    await pool.query("update users set role='admin' where email=$1", [email]);
    const r = await pool.query('select id from question_categories limit 1');
    category = String(r.rows[0].id);
  } finally {
    await pool.end();
  }
  await page.goto('/admin/imports');
  await expect(page.getByRole('heading', { name: '校验并导入数据' })).toBeVisible();
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
  await page.getByLabel('导入 JSON 数组').fill(JSON.stringify([q]));
  await page.getByRole('button', { name: '校验并导入', exact: true }).click();
  await expect(page.getByText('导入成功 · 已导入 1 行')).toBeVisible();
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
  await page.getByLabel('导入 JSON 数组').fill(JSON.stringify([j]));
  await page.getByRole('button', { name: '校验并导入', exact: true }).click();
  await expect(page.getByText('导入成功 · 已导入 1 行')).toBeVisible();
});
