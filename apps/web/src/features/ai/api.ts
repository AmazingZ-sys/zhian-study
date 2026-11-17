import type { Envelope } from '@zhian/contracts';
import { api } from '../../api';

const generationTimeout = 30_000;

export async function fetchAiEnabled(signal?: AbortSignal) {
  const { data } = await api.get<Envelope<{ enabled: boolean }>>('/ai/status', { signal });
  return data.data.enabled === true;
}

export async function generateQuestionExplanation(questionId: string, answerId: string, signal: AbortSignal) {
  const { data } = await api.post<Envelope<{ text: string }>>(
    '/ai/question-explanation',
    { questionId, answerId },
    { signal, timeout: generationTimeout },
  );
  return data.data.text;
}

export async function generateStudyAdvice(signal: AbortSignal) {
  const { data } = await api.post<Envelope<{ text: string }>>('/ai/study-advice', undefined, {
    signal,
    timeout: generationTimeout,
  });
  return data.data.text;
}
