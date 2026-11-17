import { describe, expect, it } from 'vitest';
import type { CategoryProgress } from '@zhian/contracts';
import { buildCatalog } from './catalog';

const category = (id: string, values: Partial<CategoryProgress> = {}): CategoryProgress => ({
  id,
  name: id,
  subject: '科目一',
  parentId: null,
  sort: 0,
  count: 0,
  attempted: 0,
  attempts: 0,
  correctAttempts: 0,
  ...values,
});

describe('章节目录', () => {
  it('按科目分组，并按排序值保留独立的平级章节', () => {
    const groups = buildCatalog([
      category('后章', { sort: 3 }),
      category('另一个科目', { sort: 2, subject: '科目二' }),
      category('首章', { sort: 1, count: 2 }),
    ]);

    expect(groups.map((group) => [group.subject, group.rows.map((row) => row.id)])).toEqual([
      ['科目一', ['首章', '后章']],
      ['科目二', ['另一个科目']],
    ]);
    for (const row of groups.flatMap((group) => group.rows)) {
      expect(row).toMatchObject({ depth: 0, includeDescendants: false });
    }
  });

  it('沿父子关系聚合多层题量和练习次数，并使用根章节的科目', () => {
    const groups = buildCatalog([
      category('根章', { count: 2, attempted: 1, attempts: 4, correctAttempts: 1 }),
      category('子章', { parentId: '根章', count: 4, attempted: 3, attempts: 6, correctAttempts: 5 }),
      category('叶章', {
        parentId: '子章',
        subject: '科目二',
        count: 2,
        attempted: 1,
        attempts: 1,
        correctAttempts: 1,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows).toMatchObject([
      {
        id: '根章',
        depth: 0,
        includeDescendants: true,
        progress: { count: 8, attempted: 5, attempts: 11, correctAttempts: 7 },
      },
      {
        id: '子章',
        depth: 1,
        includeDescendants: true,
        progress: { count: 6, attempted: 4, attempts: 7, correctAttempts: 6 },
      },
      {
        id: '叶章',
        depth: 2,
        includeDescendants: false,
        progress: { count: 2, attempted: 1, attempts: 1, correctAttempts: 1 },
      },
    ]);
  });

  it('展示缺少父章的分类，环内每个入口按服务端可达范围去重求和', () => {
    const rows = buildCatalog([
      category('孤儿', { parentId: '缺失' }),
      category('分支', { parentId: '环一', sort: 1, count: 1 }),
      category('环一', { parentId: '环二', sort: 2, count: 2 }),
      category('环二', { parentId: '环一', sort: 3, count: 3 }),
    ]).flatMap((group) => group.rows);

    expect(rows.map((row) => [row.id, row.depth, row.includeDescendants, row.progress.count])).toEqual([
      ['孤儿', 0, false, 0],
      ['环一', 0, true, 6],
      ['分支', 1, false, 1],
      ['环二', 1, true, 6],
    ]);
  });
});
