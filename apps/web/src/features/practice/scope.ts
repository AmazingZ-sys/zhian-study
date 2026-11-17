import type { LocationQuery, LocationQueryRaw } from 'vue-router';

export const practiceModes = [
  { value: 'sequential', label: '顺序练习' },
  { value: 'random', label: '随机练习' },
  { value: 'chapter', label: '章节练习' },
  { value: 'special', label: '专项练习' },
  { value: 'past', label: '历年真题' },
] as const;

export const practicePageSize = 10;
export type BrowseMode = (typeof practiceModes)[number]['value'];
export type PracticeScope = {
  mode: BrowseMode | 'wrong' | 'favorite';
  categoryId: string;
  paperId: string;
  includeDescendants: boolean;
  q: string;
  year: string | number;
  mastered: 'true' | 'false';
  sort: 'count' | 'recent';
  since: string;
  page: number;
};

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}

export function readPracticeScope(query: LocationQuery, listPath?: string): PracticeScope {
  const value = (name: string) => (typeof query[name] === 'string' ? query[name] : '');
  const modeParam = value('mode');
  const mode =
    listPath === '/wrong' || (!listPath && modeParam === 'wrong')
      ? 'wrong'
      : listPath === '/favorites' || (!listPath && modeParam === 'favorite')
        ? 'favorite'
        : (practiceModes.find((mode) => mode.value === modeParam)?.value ?? 'sequential');
  const categoryId = value('categoryId');
  const page = Number(value('page'));
  const year = Number(value('year'));
  return {
    mode,
    categoryId,
    paperId: mode === 'wrong' ? '' : value('paperId'),
    includeDescendants: !!categoryId && value('includeDescendants') === 'true',
    q: mode === 'wrong' ? '' : value('q').slice(0, 100),
    year: mode !== 'wrong' && Number.isInteger(year) && year >= 1990 && year <= 2100 ? year : '',
    mastered: mode === 'wrong' && value('mastered') === 'true' ? 'true' : 'false',
    sort: mode === 'wrong' && value('sort') === 'recent' ? 'recent' : 'count',
    since: mode === 'wrong' ? calendarDate(value('since')) : '',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

function practiceQuery(scope: PracticeScope, detail: boolean): LocationQueryRaw {
  const wrong = scope.mode === 'wrong';
  const review = wrong || scope.mode === 'favorite';
  return {
    mode: scope.mode !== 'sequential' && (!review || detail) ? scope.mode : undefined,
    categoryId: scope.categoryId || undefined,
    paperId: !wrong && scope.paperId ? scope.paperId : undefined,
    includeDescendants: scope.categoryId && scope.includeDescendants ? 'true' : undefined,
    q: !wrong && scope.q ? scope.q : undefined,
    year: !wrong && scope.year ? scope.year : undefined,
    sort: wrong && scope.sort === 'recent' ? scope.sort : undefined,
    mastered: wrong && scope.mastered === 'true' ? scope.mastered : undefined,
    since: wrong && scope.since ? scope.since : undefined,
    page: scope.page > 1 ? scope.page : undefined,
  };
}

export function practiceListLocation(scope: PracticeScope) {
  const path = scope.mode === 'wrong' ? '/wrong' : scope.mode === 'favorite' ? '/favorites' : '/practice';
  return { path, query: practiceQuery(scope, false) };
}

export function practiceQuestionLocation(scope: PracticeScope, questionId: string) {
  return { path: `/practice/${questionId}`, query: practiceQuery(scope, true) };
}

export function practiceFilters(scope: PracticeScope) {
  const wrong = scope.mode === 'wrong';
  const since = calendarDate(scope.since);
  return {
    categoryId: scope.categoryId || undefined,
    paperId: !wrong && scope.paperId ? scope.paperId : undefined,
    includeDescendants: scope.categoryId && scope.includeDescendants ? true : undefined,
    q: !wrong && scope.q ? scope.q : undefined,
    year: !wrong && scope.year ? Number(scope.year) : undefined,
    mastered: wrong ? scope.mastered : undefined,
    since: wrong && since ? new Date(since).toISOString() : undefined,
  };
}
