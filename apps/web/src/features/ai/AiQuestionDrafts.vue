<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Envelope, QuestionInput } from '@zhian/contracts';
import { api, errorText } from '../../api';
import { fetchAiEnabled } from './api';

const props = defineProps<{ categories: { id: string; name: string }[]; fileSelected: boolean }>();
const importText = defineModel<string>('importText', { required: true });
const enabled = ref<boolean>();
const categoryId = ref('');
const sourceLabel = ref('');
const text = ref('');
const drafts = ref<QuestionInput[]>();
const loading = ref(false);
const error = ref('');
const appended = ref(false);
const preview = computed(() => (drafts.value?.length ? JSON.stringify(drafts.value, null, 2) : ''));
const lifecycle = new AbortController();

onMounted(async () => {
  try {
    enabled.value = await fetchAiEnabled(lifecycle.signal);
  } catch {
    if (!lifecycle.signal.aborted) enabled.value = false;
  }
});
onBeforeUnmount(() => lifecycle.abort());

async function generate() {
  if (loading.value || !text.value.trim() || !sourceLabel.value.trim()) return;
  loading.value = true;
  error.value = '';
  drafts.value = undefined;
  appended.value = false;
  try {
    const { data } = await api.post<Envelope<QuestionInput[]>>(
      '/ai/question-drafts',
      {
        categoryId: categoryId.value,
        sourceLabel: sourceLabel.value.trim(),
        text: text.value.trim(),
      },
      { signal: lifecycle.signal, timeout: 30_000 },
    );
    drafts.value = data.data;
  } catch (cause) {
    if (!lifecycle.signal.aborted) error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

function appendDrafts() {
  if (!drafts.value?.length || appended.value || props.fileSelected) return;
  error.value = '';
  try {
    const existing: unknown = JSON.parse(importText.value.trim() || '[]');
    if (!Array.isArray(existing)) throw new Error('invalid import rows');
    importText.value = JSON.stringify([...existing, ...drafts.value], null, 2);
    appended.value = true;
  } catch {
    error.value = '请先将导入框整理成有效的 JSON 数组。';
  }
}
</script>

<template>
  <details v-if="enabled" class="ai-drafts mb">
    <summary>AI 整理题目原文</summary>
    <form class="stack" @submit.prevent="generate">
      <p class="muted">题目原文会发送至已配置的 AI 网关。请粘贴有权发送的客观题，含选项、答案和解析。</p>
      <div class="form-grid">
        <label>
          草稿分类
          <select v-model="categoryId" :disabled="loading" required>
            <option value="" disabled>选择已有分类</option>
            <option v-for="category in categories" :key="category.id" :value="category.id">
              {{ category.name }}
            </option>
          </select>
        </label>
        <label>
          草稿来源
          <input v-model="sourceLabel" maxlength="200" :disabled="loading" required />
        </label>
      </div>
      <label>
        题目原文
        <textarea v-model="text" rows="6" maxlength="12000" :disabled="loading" required></textarea>
      </label>
      <div class="actions">
        <button type="submit" class="button secondary" :disabled="loading">
          {{ loading ? '正在生成…' : '生成题目草稿' }}
        </button>
        <button
          v-if="preview"
          type="button"
          class="button secondary"
          :disabled="fileSelected || appended"
          @click="appendDrafts"
        >
          追加到导入 JSON
        </button>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="drafts && !drafts.length" class="muted" role="status">
        原文中未识别出含答案和解析的完整题目。
      </p>
      <template v-if="preview">
        <p v-if="appended" class="form-success" role="status">
          已追加到导入 JSON。核对后点击「校验并导入」。
        </p>
        <p v-else class="muted" role="status">
          {{
            fileSelected
              ? '请取消文件选择后追加。'
              : `已生成 ${drafts?.length} 道待核验且停用的题目。追加后可在导入框编辑。`
          }}
        </p>
        <label>AI 题目草稿<textarea :value="preview" class="json-editor" readonly rows="8"></textarea></label>
      </template>
    </form>
  </details>
  <p v-else-if="enabled === false" class="muted mb">
    <RouterLink class="text-link" to="/admin/ai">配置 AI 网关</RouterLink>后可从原文生成题目草稿。
  </p>
</template>

<style scoped>
.ai-drafts {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 14px;
  min-width: 0;
}
.ai-drafts summary {
  min-height: 36px;
  padding-block: 6px;
  cursor: pointer;
  font-weight: 650;
}
.ai-drafts form {
  margin-top: 10px;
}
</style>
