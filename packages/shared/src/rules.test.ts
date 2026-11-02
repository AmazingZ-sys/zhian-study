import { describe, it, expect } from 'vitest';
import { answersEqual, matchJob } from './index';
import { profileSchema, jobSchema, questionSchema } from '@zhian/contracts';
const job = jobSchema.parse({
  year: 2027,
  examType: '省考',
  province: '浙江',
  organization: '测试单位',
  title: '技术岗',
  code: 'T1',
  headcount: 1,
  education: '本科',
  majorText: '计算机类',
  majorCodes: ['0809'],
  sourceId: '00000000-0000-4000-8000-000000000001',
  sourceLabel: '测试',
  sourceUrl: 'https://example.com',
  publishedAt: '2026-10-01T00:00:00Z',
  status: 'verified',
});
describe('判分与匹配', () => {
  it('多选题顺序无关，但重复、漏选或多选不正确', () => {
    expect(answersEqual(['C', 'A'], ['A', 'C'])).toBe(true);
    expect(answersEqual(['A', 'A'], ['A', 'C'])).toBe(false);
    expect(answersEqual(['A'], ['A', 'C'])).toBe(false);
    expect(answersEqual(['A', 'B', 'C'], ['A', 'C'])).toBe(false);
  });
  it('按编码/类别和显式别名匹配，不做字符串包含', () => {
    const p = profileSchema.parse({ major: '软工', age: 24 });
    const catalog = [{ code: '080902', name: '软件工程', category: '0809', aliases: ['软工'] }];
    expect(matchJob(p, job, catalog).status).toBe('符合');
    expect(matchJob({ ...p, major: '软件' }, job, catalog).status).toBe('需要人工确认');
  });
  it('学历不符合优先；未知年龄及演示数据不直接判符合', () => {
    const p = profileSchema.parse({ education: '大专' });
    expect(matchJob(p, job, []).status).toBe('不符合');
    expect(matchJob(profileSchema.parse({}), { ...job, majorText: '不限', majorCodes: [] }, []).status).toBe(
      '需要人工确认',
    );
    expect(
      matchJob(
        profileSchema.parse({ age: 24 }),
        { ...job, status: 'demo', majorText: '不限', majorCodes: [] },
        [],
      ).status,
    ).toBe('需要人工确认');
  });
  it('拒绝答案不存在于选项的题目', () => {
    expect(
      questionSchema.safeParse({
        title: '测试',
        subject: '数学',
        categoryId: '00000000-0000-4000-8000-000000000001',
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
        ],
        correctAnswer: ['C'],
        explanation: '解释',
        sourceLabel: '原创',
      }).success,
    ).toBe(false);
  });
  it('拒绝脚本链接及倒置的时间和年龄', () => {
    expect(jobSchema.safeParse({ ...job, sourceUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(jobSchema.safeParse({ ...job, minAge: 40, maxAge: 30 }).success).toBe(false);
    expect(
      jobSchema.safeParse({
        ...job,
        registrationStart: '2027-02-01T00:00:00Z',
        registrationEnd: '2027-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});
