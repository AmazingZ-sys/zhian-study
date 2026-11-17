import { describe, expect, it } from 'vitest';
import { safeImageUrl, questionPreview } from './content';
import { practiceFilters, practiceListLocation, practiceQuestionLocation, readPracticeScope } from './scope';

describe('题库内容与范围', () => {
  it('将题库配图指向跨域API，拒绝其他本地路径和危险协议', () => {
    expect(safeImageUrl('/api/v1/bank-assets/a.png', 'https://api.example.com/api/v1')).toBe(
      'https://api.example.com/api/v1/bank-assets/a.png',
    );
    for (const value of [
      '/etc/passwd',
      '/api/v1/bank-assets/..',
      'data:image/svg+xml,<svg/>',
      'javascript:alert(1)',
      'https://user:pass@example.com/a.png',
    ])
      expect(safeImageUrl(value)).toBeUndefined();
  });
  it('原卷范围经过题目、返回和请求过滤后仍保留', () => {
    const scope = readPracticeScope({ paperId: 'paper-one', page: '3' });
    expect(practiceQuestionLocation(scope, 'question-one').query).toMatchObject({
      paperId: 'paper-one',
      page: 3,
    });
    expect(practiceListLocation(scope).query).toMatchObject({ paperId: 'paper-one', page: 3 });
    expect(practiceFilters(scope)).toMatchObject({ paperId: 'paper-one' });
    expect(questionPreview('题干 **重点** ![配图](/api/v1/bank-assets/a.png)')).toBe('题干 重点 【配图】');
  });
});
