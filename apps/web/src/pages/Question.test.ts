// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import Question from './Question.vue';
import {
  fetchPracticeQuestion,
  revealQuestionSolution,
  submitPracticeAnswer,
} from '../features/practice/api';

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: { id: 'subjective-one' },
    query: { paperId: 'paper-one' },
    fullPath: '/practice/subjective-one?paperId=paper-one',
  }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../features/practice/api', () => ({
  fetchPracticeQuestion: vi.fn(async () => ({
    question: {
      id: 'subjective-one',
      type: 'subjective',
      title: '归纳材料中的问题',
      material: '材料正文',
      subject: '公务员·申论',
      options: [],
      status: 'pending',
      sourceLabel: '参考原卷',
    },
    history: [],
  })),
  revealQuestionSolution: vi.fn(async () => ({ explanation: '参考作答思路' })),
  submitPracticeAnswer: vi.fn(),
  findNextQuestion: vi.fn(),
  setQuestionFavorite: vi.fn(),
  setQuestionNote: vi.fn(),
}));

describe('主观题阅读', () => {
  it('先显示材料，主动查看参考解析，全程不提交客观答案', async () => {
    const wrapper = mount(Question, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
    await flushPromises();
    expect(fetchPracticeQuestion).toHaveBeenCalledWith('subjective-one', 'paper-one');
    expect(wrapper.text()).toContain('材料正文');
    expect(wrapper.text()).not.toContain('参考作答思路');
    expect(wrapper.findAll('.option')).toHaveLength(0);
    const reveal = wrapper.findAll('button').find((button) => button.text() === '查看参考解析');
    expect(reveal).toBeDefined();
    await reveal!.trigger('click');
    await flushPromises();
    expect(revealQuestionSolution).toHaveBeenCalledWith('subjective-one');
    expect(wrapper.text()).toContain('参考作答思路');
    expect(wrapper.text()).not.toContain('回答正确');
    expect(submitPracticeAnswer).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('下一题');
    wrapper.unmount();
  });
});
