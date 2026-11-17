import type { CategoryProgress } from '@zhian/contracts';

type Progress = Pick<CategoryProgress, 'count' | 'attempted' | 'attempts' | 'correctAttempts'>;

type CatalogRow = {
  id: string;
  name: string;
  depth: number;
  includeDescendants: boolean;
  progress: Progress;
};

type SubjectGroup = { subject: string; rows: CatalogRow[] };

export function buildCatalog(categories: CategoryProgress[]): SubjectGroup[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const ordered = [...byId.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN'));
  const childrenByParent = new Map<string, CategoryProgress[]>();
  const roots: CategoryProgress[] = [];
  const visited = new Set<string>();
  const groups = new Map<string, SubjectGroup>();

  for (const category of ordered) {
    if (!category.parentId || !byId.has(category.parentId)) {
      roots.push(category);
      continue;
    }
    const siblings = childrenByParent.get(category.parentId) ?? [];
    siblings.push(category);
    childrenByParent.set(category.parentId, siblings);
  }

  function appendRoot(root: CategoryProgress, cycle?: Set<string>) {
    type Position = { category: CategoryProgress; parent?: CatalogRow };
    const pending: Position[] = [{ category: root }];
    const entries: { row: CatalogRow; parent?: CatalogRow }[] = [];

    while (pending.length) {
      const { category, parent } = pending.pop()!;
      const { id, name, count, attempted, attempts, correctAttempts } = category;
      if (visited.has(id)) continue;
      visited.add(id);
      const children = childrenByParent.get(id) ?? [];
      const row: CatalogRow = {
        id,
        name,
        depth: parent ? parent.depth + 1 : 0,
        includeDescendants: children.some((child) => child.id !== id),
        progress: { count, attempted, attempts, correctAttempts },
      };
      entries.push({ row, parent });
      for (let index = children.length - 1; index >= 0; index--) {
        pending.push({ category: children[index]!, parent: row });
      }
    }

    for (let index = entries.length - 1; index > 0; index--) {
      const { row, parent } = entries[index]!;
      const subtotal = parent!.progress;
      subtotal.count += row.progress.count;
      subtotal.attempted += row.progress.attempted;
      subtotal.attempts += row.progress.attempts;
      subtotal.correctAttempts += row.progress.correctAttempts;
    }

    const group = groups.get(root.subject) ?? { subject: root.subject, rows: [] };
    const rootProgress = entries[0]!.row.progress;
    for (const { row } of entries) {
      // Any chapter on the same cycle can reach the whole component in the API.
      if (cycle?.has(row.id)) row.progress = { ...rootProgress };
      group.rows.push(row);
    }
    groups.set(root.subject, group);
  }

  roots.forEach((root) => appendRoot(root));

  for (const category of ordered) {
    if (visited.has(category.id)) continue;
    // The remaining branches have no root. Find the cycle before choosing a display root.
    const path = new Set<string>();
    let root = category;
    while (!path.has(root.id)) {
      path.add(root.id);
      root = byId.get(root.parentId!)!;
    }
    const cycle = new Set([root.id]);
    for (let parentId = root.parentId!; parentId !== root.id; parentId = byId.get(parentId)!.parentId!) {
      cycle.add(parentId);
    }
    appendRoot(root, cycle);
  }

  return [...groups.values()];
}
