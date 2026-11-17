<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { errorText } from '../../api';
import RichText from '../../components/RichText.vue';
import { fetchAiEnabled } from './api';

const props = defineProps<{
  title: string;
  disclosure: string;
  action: string;
  unavailableReason?: string;
  generate: (signal: AbortSignal) => Promise<string>;
}>();

const headingId = useId();
const enabled = ref(false);
const pending = ref(false);
const error = ref('');
const text = ref('');
const controller = new AbortController();
const { signal } = controller;

onMounted(async () => {
  try {
    const available = await fetchAiEnabled(signal);
    if (!signal.aborted) enabled.value = available;
  } catch {
    // A connection error here leaves the main page and its actions available.
  }
});
onBeforeUnmount(() => controller.abort());

async function runGeneration() {
  if (pending.value || !enabled.value || props.unavailableReason) return;
  pending.value = true;
  error.value = '';
  try {
    const result = await props.generate(signal);
    if (!signal.aborted) text.value = result;
  } catch (e) {
    if (!signal.aborted) error.value = errorText(e);
  } finally {
    if (!signal.aborted) pending.value = false;
  }
}
</script>

<template>
  <section v-if="enabled" class="ai-result" :aria-labelledby="headingId">
    <h3 :id="headingId">{{ title }}</h3>
    <p v-if="unavailableReason" class="ai-result-note muted">{{ unavailableReason }}</p>
    <template v-else>
      <p v-if="!text" class="ai-result-note muted">{{ disclosure }}</p>
      <button v-if="!text" class="button secondary" type="button" :disabled="pending" @click="runGeneration">
        {{ action }}
      </button>
      <p class="ai-result-status muted" role="status">
        {{ pending ? '正在生成…' : text ? 'AI 生成 · 仅供复盘参考' : '' }}
      </p>
      <p v-if="error" class="ai-result-error" role="alert">{{ error }}</p>
      <RichText v-if="text" :text="text" />
    </template>
  </section>
</template>

<style scoped>
.ai-result {
  margin-top: 20px;
  border-top: 1px solid var(--line);
  padding-top: 16px;
  min-width: 0;
}
.ai-result-note {
  margin: 6px 0 10px;
  font-size: 13px;
}
.ai-result-status:not(:empty),
.ai-result-error {
  margin: 8px 0;
  font-size: 13px;
}
.ai-result-error {
  color: #a44335;
}
</style>
