<script setup lang="ts">
defineProps<{ status: string }>();
const labels: Record<string, string> = {
  demo: '演示数据',
  pending: '待核验',
  verified: '已核验',
  expired: '已失效',
};
</script>
<template>
  <span class="badge" :class="status">{{ labels[status] || status }}</span>
</template>
