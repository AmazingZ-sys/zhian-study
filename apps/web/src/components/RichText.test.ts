// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import RichText from './RichText.vue';
describe('富文本安全展示', () => {
  it('展示强调、段落和引用，同时将 HTML 和脚本作为文本', () => {
    const text =
      '**关键条件**：标准大气压\n\n> 请注意条件\n\n<img src=x onerror=alert(1)><script>alert(1)</script>';
    const wrapper = mount(RichText, { props: { text } });
    expect(wrapper.get('strong').text()).toBe('关键条件');
    expect(wrapper.get('blockquote').text()).toBe('请注意条件');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.text()).toContain('<script>alert(1)</script>');
  });
});
