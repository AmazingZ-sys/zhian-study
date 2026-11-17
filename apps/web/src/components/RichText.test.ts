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
  it('展示本地配图和公式图片，拒绝可执行协议和路径越界', () => {
    const wrapper = mount(RichText, {
      props: {
        text: '![图形](/api/v1/bank-assets/figure-1.png)\n\n![公式](https://example.com/formula?x=a%28b%29)\n\n![攻击](javascript:alert(1))\n\n![越界](/api/v1/bank-assets/../secret)',
      },
    });
    const images = wrapper.findAll('img');
    expect(images).toHaveLength(2);
    expect(images[0]!.attributes('src')).toBe('/api/v1/bank-assets/figure-1.png');
    expect(images[1]!.attributes('src')).toBe('https://example.com/formula?x=a%28b%29');
    expect(images.every((img) => img.attributes('referrerpolicy') === 'no-referrer')).toBe(true);
    expect(wrapper.text()).toContain('javascript:');
  });
});
