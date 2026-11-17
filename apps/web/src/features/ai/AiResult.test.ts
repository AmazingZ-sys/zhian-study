// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import AiResult from './AiResult.vue';
import { fetchAiEnabled } from './api';

vi.mock('./api', () => ({ fetchAiEnabled: vi.fn() }));

const props = { title: 'AI 解析', disclosure: '将发送题目文字和本次作答。', action: '生成 AI 解析' };

describe('AI 生成区块', () => {
  it('服务关闭或状态请求失败时隐藏区块，且不调用模型', async () => {
    vi.mocked(fetchAiEnabled).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('连接失败'));
    const generate = vi.fn<(signal: AbortSignal) => Promise<string>>();

    for (const wrapper of [
      mount(AiResult, { props: { ...props, generate } }),
      mount(AiResult, { props: { ...props, generate } }),
    ]) {
      await flushPromises();
      expect(wrapper.find('section').exists()).toBe(false);
      wrapper.unmount();
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it('点击后才生成，失败可重试，生成文本无法插入 HTML', async () => {
    vi.mocked(fetchAiEnabled).mockResolvedValueOnce(true);
    const generate = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new Error('网关暂不可用'))
      .mockResolvedValueOnce('**解题思路**\n\n<img src=x onerror=alert(1)>');
    const wrapper = mount(AiResult, { props: { ...props, generate } });
    await flushPromises();
    expect(generate).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain(props.disclosure);

    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('网关暂不可用');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.get('strong').text()).toBe('解题思路');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain('AI 生成');
    wrapper.unmount();
  });

  it('生成期间屏蔽重复提交，卸载时取消请求', async () => {
    vi.mocked(fetchAiEnabled).mockResolvedValueOnce(true);
    const generate = vi.fn((_signal: AbortSignal) => new Promise<string>(() => {}));
    const wrapper = mount(AiResult, { props: { ...props, generate } });
    await flushPromises();
    await wrapper.get('button').trigger('click');
    await wrapper.get('button').trigger('click');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[role="status"]').text()).toBe('正在生成…');
    expect(generate).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(generate.mock.calls[0]?.[0].aborted).toBe(true);
  });
});
