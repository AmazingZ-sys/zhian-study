import { eq } from 'drizzle-orm';
import { db, pool } from './index.js';
import { categories, questions, jobs, announcements, sources, majors, users, profiles } from './schema.js';
import { questionSchema, jobSchema, announcementSchema, profileSchema, authSchema } from '@zhian/contracts';
import { saveQuestion, saveJob, saveAnnouncement } from '../admin.js';
import { hashPassword } from '../auth.js';
if (process.env.NODE_ENV === 'production') throw new Error('禁止在生产环境执行演示种子');
const material = [
  [
    '常识判断',
    '日常科学',
    '水在标准大气压下的沸点是？',
    ['0℃', '50℃', '100℃', '200℃'],
    ['C'],
    '标准大气压下，纯水的沸点为 100℃。',
    'single',
  ],
  [
    '言语理解',
    '词句理解',
    '“循序渐进”最适合描述下列哪种学习方式？',
    ['一口气学完所有内容', '按阶段逐步提高难度', '只学习最困难的内容', '完全跳过基础'],
    ['B'],
    '循序渐进指按一定次序和步骤逐渐深入或提高。',
    'single',
  ],
  [
    '数量关系',
    '基础运算',
    '某班有 24 人，其中 3/8 参加读书活动。参加活动的有多少人？',
    ['6 人', '8 人', '9 人', '12 人'],
    ['C'],
    '24 × 3/8 = 9。',
    'single',
  ],
  [
    '判断推理',
    '逻辑判断',
    '所有甲组成员都参加培训，小林是甲组成员。可推出：',
    ['小林参加培训', '小林不参加培训', '只有小林参加培训', '无法判断'],
    ['A'],
    '由全称命题和成员归属可推出小林参加培训。',
    'single',
  ],
  [
    '资料分析',
    '增长率',
    '某项数量从 80 增长到 100，增长率为多少？',
    ['20%', '25%', '80%', '125%'],
    ['B'],
    '增长率=(100−80)/80=25%。',
    'single',
  ],
  [
    '数量关系',
    '基础运算',
    '下列哪些数是偶数？',
    ['12', '15', '18', '21'],
    ['A', 'C'],
    '12 和 18 能被 2 整除。多选题需完整选对。',
    'multiple',
  ],
  [
    '判断推理',
    '逻辑判断',
    '“若 A 则 B”为真且 A 为真，可以推出 B 为真。',
    ['正确', '错误'],
    ['A'],
    '肯定前件式为有效推理。',
    'boolean',
  ],
  [
    '资料分析',
    '增长率',
    '数据依次为 10、20、30，平均数为多少？',
    ['15', '20', '25', '30'],
    ['B'],
    '(10+20+30)/3=20。',
    'single',
  ],
  [
    '言语理解',
    '词句理解',
    '“持之以恒”的近义表达是：',
    ['半途而废', '坚持不懈', '浅尝辄止', '随心所欲'],
    ['B'],
    '两者都强调长久坚持。',
    'single',
  ],
  [
    '常识判断',
    '日常科学',
    '地球围绕太阳公转一周约需：',
    ['一天', '一个月', '一年', '十年'],
    ['C'],
    '地球公转周期约为一年。',
    'single',
  ],
  [
    '数量关系',
    '基础运算',
    '一本书 120 页，每天读 15 页，需要几天读完？',
    ['6', '7', '8', '9'],
    ['C'],
    '120 ÷ 15 = 8。',
    'single',
  ],
  [
    '判断推理',
    '逻辑判断',
    '小张比小李高，小李比小王高。三人中最高的是：',
    ['小张', '小李', '小王', '无法判断'],
    ['A'],
    '高矮关系具有传递性。',
    'single',
  ],
] as const;
try {
  await db.transaction(async (tx) => {
    let [source] = await tx.select().from(sources).where(eq(sources.name, '知岸原创演示'));
    if (!source)
      [source] = await tx
        .insert(sources)
        .values({
          name: '知岸原创演示',
          url: 'https://example.com/zhian-demo',
          terms: '本项目原创示例，仅用于功能演示，不是真实招录信息。',
          verification: 'demo',
          version: '1',
        })
        .returning();
    for (const [subject, name, title, choices, answer, explanation, type] of material) {
      let [category] = await tx.select().from(categories).where(eq(categories.name, name));
      if (!category)
        [category] = await tx
          .insert(categories)
          .values({
            name,
            subject,
            sort: ['常识判断', '言语理解', '数量关系', '判断推理', '资料分析'].indexOf(subject),
          })
          .returning();
      if (!(await tx.select().from(questions).where(eq(questions.title, title))).length)
        await saveQuestion(
          tx,
          questionSchema.parse({
            title,
            subject,
            categoryId: category!.id,
            type,
            options: choices.map((text, i) => ({ key: String.fromCharCode(65 + i), text })),
            correctAnswer: [...answer],
            explanation,
            sourceId: source!.id,
            sourceLabel: '知岸原创 · 演示题',
            status: 'demo',
          }),
        );
    }
    for (const [code, name, category, aliases] of [
      ['080901', '计算机科学与技术', '0809', ['计算机科学']],
      ['080902', '软件工程', '0809', []],
      ['030101K', '法学', '0301', []],
    ] as const)
      await tx
        .insert(majors)
        .values({ code, name, category, aliases: [...aliases], version: '示例目录-需按当年官方目录核验' })
        .onConflictDoNothing();
    for (const [index, province, city, title, organization] of [
      [1, '浙江', '杭州', '综合管理岗', '示例公共服务中心'],
      [2, '江苏', '南京', '信息技术岗', '示例数字服务中心'],
      [3, '广东', '广州', '文字综合岗', '示例政务研究中心'],
    ] as const) {
      const code = `DEMO-2027-${index}`;
      if (!(await tx.select().from(jobs).where(eq(jobs.code, code))).length)
        await saveJob(
          tx,
          jobSchema.parse({
            year: 2027,
            examType: '事业单位',
            province,
            city,
            title,
            organization,
            code,
            headcount: index,
            education: '本科',
            degree: '学士',
            majorCodes: index === 2 ? ['0809'] : [],
            majorText: index === 2 ? '计算机类' : '不限',
            sourceId: source!.id,
            sourceUrl: 'https://example.com/zhian-demo',
            sourceLabel: '虚构岗位 · 仅用于演示',
            publishedAt: '2026-10-01T00:00:00Z',
            registrationStart: '2027-01-01T00:00:00Z',
            registrationEnd: '2027-01-20T09:00:00Z',
            status: 'demo',
          }),
        );
    }
    const title = '使用指南：如何核对招录公告与岗位条件';
    if (!(await tx.select().from(announcements).where(eq(announcements.title, title))).length)
      await saveAnnouncement(
        tx,
        announcementSchema.parse({
          title,
          type: '报名通知',
          examType: '综合',
          province: '全国',
          body: '这是一篇演示公告，不是真实招录通知。\n\n请优先阅读官方公告，核对职位代码、学历学位、专业目录、年龄截止日和基层工作经历认定标准。\n\n系统匹配仅作辅助。遇到模糊资格条件，应联系招录单位。收藏岗位后，可以在站内提醒查看报名截止时间。',
          sourceId: source!.id,
          sourceUrl: 'https://example.com/zhian-demo',
          sourceLabel: '知岸原创使用指南 · 演示',
          publishedAt: '2026-10-01T00:00:00Z',
          status: 'demo',
        }),
      );
  });
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const input = authSchema.parse({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    if (!(await db.select().from(users).where(eq(users.email, input.email))).length)
      await db.transaction(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({
            email: input.email,
            passwordHash: await hashPassword(input.password),
            name: '管理员',
            role: 'admin',
          })
          .returning();
        await tx.insert(profiles).values({ userId: u!.id, data: profileSchema.parse({}) });
      });
  }
  console.log('原创演示数据已写入（可重复运行，不覆盖已有内容）');
} finally {
  await pool.end();
}
