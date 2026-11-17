import type {
  AnswerResult,
  Category,
  CategoryProgress,
  Envelope,
  PageMeta,
  Question,
} from '@zhian/contracts';
import { api } from '../../api';
import { practiceFilters, practicePageSize, type PracticeScope } from './scope';

export async function fetchPracticeList(scope: PracticeScope, signal: AbortSignal) {
  const wrong = scope.mode === 'wrong';
  const { data } = await api.get<{ data: Question[]; meta: PageMeta }>(
    wrong ? '/wrong-questions' : '/questions',
    {
      signal,
      params: {
        ...practiceFilters(scope),
        ...(wrong ? { sort: scope.sort } : { mode: scope.mode }),
        page: scope.page,
        pageSize: practicePageSize,
      },
    },
  );
  return data;
}

export async function fetchCategoryProgress(signal?: AbortSignal) {
  return (await api.get<Envelope<CategoryProgress[]>>('/question-categories/progress', { signal })).data.data;
}

export async function fetchCategories(signal: AbortSignal) {
  return (await api.get<Envelope<Category[]>>('/question-categories', { signal })).data.data;
}

export async function findNextQuestion(scope: PracticeScope, questionId: string) {
  const { data } = await api.get<Envelope<Question[]>>('/questions', {
    params: { ...practiceFilters(scope), mode: scope.mode, after: questionId, pageSize: 1 },
  });
  return data.data[0];
}

export async function fetchPracticeQuestion(id: string, paperId?: string) {
  const [question, history] = await Promise.all([
    api.get<Envelope<Question>>(`/questions/${id}`, { params: { paperId: paperId || undefined } }),
    api.get<Envelope<AnswerResult[]>>(`/questions/${id}/history`),
  ]);
  return { question: question.data.data, history: history.data.data };
}

export async function submitPracticeAnswer(id: string, answer: string[], seconds: number, requestId: string) {
  const response = await api.post<Envelope<AnswerResult>>(`/questions/${id}/answer`, {
    answer,
    seconds,
    requestId,
  });
  return response.data.data;
}

export async function setQuestionFavorite(id: string, favorite: boolean) {
  const { data } = await api.request<Envelope<{ favorite: boolean }>>({
    url: `/questions/${id}/favorite`,
    method: favorite ? 'POST' : 'DELETE',
  });
  return data.data.favorite;
}

export function setQuestionNote(id: string, note: string) {
  return api.patch(`/questions/${id}/note`, { note });
}

export async function revealQuestionSolution(id: string) {
  return (await api.get<Envelope<{ explanation: string }>>(`/questions/${id}/solution`)).data.data;
}

export function setQuestionMastered(id: string, mastered: boolean) {
  return api.patch(`/wrong-questions/${id}/mastered`, { mastered });
}
