<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import type { AiSettings, Envelope } from '@zhian/contracts';
import { api, errorText } from '../../api';
import AsyncState from '../../components/AsyncState.vue';

const saved = ref<AiSettings>();
const form = reactive({
  enabled: false,
  baseUrl: '',
  model: '',
  tokenLimitField: 'max_completion_tokens' as AiSettings['tokenLimitField'],
});
const apiKey = ref('');
const removeKey = ref(false);
const loading = ref(true);
const busy = ref<'save' | 'test'>();
const loadError = ref('');
const actionError = ref('');
const feedback = ref('');
const lifecycle = new AbortController();
const dirty = computed(
  () =>
    !saved.value ||
    form.enabled !== saved.value.enabled ||
    form.baseUrl.trim() !== saved.value.baseUrl ||
    form.model.trim() !== saved.value.model ||
    form.tokenLimitField !== saved.value.tokenLimitField ||
    !!apiKey.value.trim() ||
    removeKey.value,
);

function apply(settings: AiSettings) {
  saved.value = settings;
  form.enabled = settings.enabled;
  form.baseUrl = settings.baseUrl;
  form.model = settings.model;
  form.tokenLimitField = settings.tokenLimitField;
  apiKey.value = '';
  removeKey.value = false;
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const { data } = await api.get<Envelope<AiSettings>>('/ai/settings', { signal: lifecycle.signal });
    apply(data.data);
  } catch (error) {
    if (!lifecycle.signal.aborted) loadError.value = errorText(error);
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (busy.value) return;
  busy.value = 'save';
  actionError.value = '';
  feedback.value = '';
  try {
    const { data } = await api.patch<Envelope<AiSettings>>(
      '/ai/settings',
      {
        ...form,
        apiKey: removeKey.value ? null : apiKey.value.trim() || undefined,
      },
      { signal: lifecycle.signal },
    );
    apply(data.data);
    feedback.value = 'AI 配置已保存';
  } catch (error) {
    if (!lifecycle.signal.aborted) actionError.value = errorText(error);
  } finally {
    busy.value = undefined;
  }
}

async function testConnection() {
  if (busy.value || dirty.value) return;
  busy.value = 'test';
  actionError.value = '';
  feedback.value = '';
  try {
    await api.post('/ai/settings/test', undefined, { signal: lifecycle.signal, timeout: 30_000 });
    feedback.value = 'AI 网关连接成功';
  } catch (error) {
    if (!lifecycle.signal.aborted) actionError.value = errorText(error);
  } finally {
    busy.value = undefined;
  }
}

onMounted(load);
onBeforeUnmount(() => lifecycle.abort());
</script>

<template>
  <section class="panel" aria-labelledby="ai-settings-title">
    <h2 id="ai-settings-title" class="mb">AI 设置</h2>
    <AsyncState :loading="loading" :error="loadError" @retry="load">
      <form class="stack" @submit.prevent="save">
        <label class="ai-enabled">
          <input v-model="form.enabled" type="checkbox" :disabled="!!busy" /> 启用 AI 功能
        </label>
        <label>
          中转站地址
          <input
            v-model="form.baseUrl"
            type="url"
            required
            maxlength="2048"
            placeholder="https://relay.example.com/v1"
            :disabled="!!busy"
          />
          <small>填写 API 根地址或完整的 /chat/completions 地址。</small>
        </label>
        <div class="form-grid">
          <label>
            模型名
            <input v-model="form.model" required maxlength="200" :disabled="!!busy" />
          </label>
          <label>
            输出长度参数
            <select v-model="form.tokenLimitField" :disabled="!!busy">
              <option value="max_completion_tokens">max_completion_tokens</option>
              <option value="max_tokens">max_tokens</option>
            </select>
          </label>
        </div>
        <div>
          <label>
            API Key
            <input
              v-model="apiKey"
              type="password"
              autocomplete="new-password"
              maxlength="2048"
              :disabled="!!busy || removeKey"
            />
          </label>
          <p class="muted ai-key-note">
            {{
              removeKey
                ? '保存后移除当前密钥。'
                : saved?.hasApiKey
                  ? '已设置密钥。留空保留同一网关的密钥，更换网关请填写对应密钥。'
                  : '可选。由中转站签发，保存后加密。'
            }}
          </p>
          <button
            v-if="saved?.hasApiKey"
            type="button"
            class="button ghost small"
            :disabled="!!busy"
            @click="
              removeKey = !removeKey;
              apiKey = '';
            "
          >
            {{ removeKey ? '取消移除密钥' : '移除已保存密钥' }}
          </button>
        </div>
        <div class="actions">
          <button type="submit" class="button" :disabled="!!busy || !dirty">
            {{ busy === 'save' ? '正在保存…' : '保存配置' }}
          </button>
          <button
            type="button"
            class="button secondary"
            :disabled="!!busy || dirty || !saved?.baseUrl"
            @click="testConnection"
          >
            {{ busy === 'test' ? '正在测试…' : '测试连接' }}
          </button>
        </div>
        <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
        <p v-else-if="feedback" class="form-success" role="status">{{ feedback }}</p>
      </form>
    </AsyncState>
  </section>
</template>

<style scoped>
.ai-enabled {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
.ai-enabled input {
  width: 18px;
  min-height: unset;
  height: 18px;
  margin: 0;
  accent-color: var(--primary);
}
.ai-key-note {
  margin-top: 6px;
  font-size: 12px;
}
</style>
