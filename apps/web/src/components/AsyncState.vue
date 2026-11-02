<script setup lang="ts">
defineProps<{ loading?: boolean; error?: string; empty?: boolean; emptyText?: string }>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <div v-if="loading" class="state-box" role="status">
    <span class="loading-ring"></span>
    <p>正在整理数据，请稍候…</p>
  </div>
  <div v-else-if="error" class="state-box error-box" role="alert">
    <h3>暂时没能加载</h3>
    <p>{{ error }}</p>
    <button class="button secondary" @click="$emit('retry')">重新加载</button>
  </div>
  <div v-else-if="empty" class="state-box">
    <span class="empty-symbol">—</span>
    <h3>{{ emptyText || '这里还没有内容' }}</h3>
    <p>下一步，从一次练习或一次收藏开始。</p>
    <slot name="empty-action" />
  </div>
  <slot v-else />
</template>
