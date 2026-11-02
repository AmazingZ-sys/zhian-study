// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import AsyncState from './AsyncState.vue';
import DataBadge from './DataBadge.vue';
describe('用户可见状态', () => {
  it('加载与失败时不展示业务内容，失败支持重试', async () => {
    const w = mount(AsyncState, { props: { loading: true }, slots: { default: '真实业务内容' } });
    expect(w.text()).not.toContain('真实业务内容');
    await w.setProps({ loading: false, error: '数据库连接不可用' });
    expect(w.get('[role="alert"]').text()).toContain('数据库连接不可用');
    await w.get('button').trigger('click');
    expect(w.emitted('retry')).toHaveLength(1);
  });
  it('演示数据始终有明确标签', () => {
    expect(mount(DataBadge, { props: { status: 'demo' } }).text()).toBe('演示数据');
  });
  it('空状态不会显示虚假数据', () => {
    const w = mount(AsyncState, {
      props: { empty: true, emptyText: '暂无岗位' },
      slots: { default: '1234 个岗位' },
    });
    expect(w.text()).toContain('暂无岗位');
    expect(w.text()).not.toContain('1234');
  });
});
