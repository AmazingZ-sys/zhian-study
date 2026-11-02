<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Bookmark, ArrowRight, ArrowLeft, Clock3 } from 'lucide-vue-next';
import { ElMessage } from 'element-plus';
import type { Question, AnswerResult } from '@zhian/contracts';
import { api, errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
import DataBadge from '../components/DataBadge.vue';
import RichText from '../components/RichText.vue';
const route = useRoute(),
  router = useRouter(),
  question = ref<Question>(),
  loading = ref(true),
  error = ref(''),
  answer = ref<string[]>([]),
  result = ref<AnswerResult>(),
  history = ref<AnswerResult[]>([]),
  note = ref(''),
  busy = ref(false),
  seconds = ref(0),
  saved = ref(false),
  key = crypto.randomUUID();
let timer: ReturnType<typeof setInterval>;
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [q, h] = await Promise.all([
      api.get('/questions/' + route.params.id),
      api.get('/questions/' + route.params.id + '/history'),
    ]);
    question.value = q.data.data;
    history.value = h.data.data;
    note.value = q.data.data.note;
    seconds.value = 0;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
function choose(k: string) {
  if (result.value || busy.value) return;
  if (question.value?.type === 'multiple')
    answer.value = answer.value.includes(k) ? answer.value.filter((x) => x !== k) : [...answer.value, k];
  else answer.value = [k];
}
async function submit() {
  if (!answer.value.length) return;
  busy.value = true;
  try {
    result.value = (
      await api.post('/questions/' + route.params.id + '/answer', {
        answer: answer.value,
        seconds: seconds.value,
        requestId: key,
      })
    ).data.data;
    history.value.unshift(result.value!);
  } catch (e) {
    ElMessage.error(errorText(e));
  } finally {
    busy.value = false;
  }
}
async function favorite() {
  if (!question.value) return;
  try {
    const p = '/questions/' + question.value.id + '/favorite';
    await api.request({ url: p, method: question.value.favorite ? 'DELETE' : 'POST' });
    question.value.favorite = !question.value.favorite;
  } catch (e) {
    ElMessage.error(errorText(e));
  }
}
async function save() {
  try {
    await api.patch('/questions/' + route.params.id + '/note', { note: note.value });
    saved.value = true;
    ElMessage.success('笔记已保存');
  } catch (e) {
    ElMessage.error(errorText(e));
  }
}
async function next() {
  try {
    const rows: Question[] = (
      await api.get('/questions', {
        params: {
          mode: route.query.mode ?? 'sequential',
          categoryId: route.query.categoryId || undefined,
          year: route.query.year || undefined,
          q: route.query.q || undefined,
          after: route.params.id,
          pageSize: 1,
        },
      })
    ).data.data;
    const target = rows[0];
    if (target) await router.push({ path: '/practice/' + target.id, query: route.query });
    else ElMessage.info('当前范围已没有下一题，可以返回选择其他章节。');
  } catch (e) {
    ElMessage.error(errorText(e));
  }
}
onMounted(() => {
  void load();
  timer = setInterval(() => {
    if (!result.value && !loading.value && document.visibilityState === 'visible') seconds.value++;
  }, 1000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>
<template>
  <div class="page-heading">
    <div>
      <RouterLink class="text-link mb" to="/practice"><ArrowLeft :size="15" />返回刷题中心</RouterLink>
      <h1>专注这一题。</h1>
      <p>想清楚再作答，理解比速度更重要。</p>
    </div>
    <span class="actions muted"
      ><Clock3 :size="16" />{{ Math.floor(seconds / 60) }} 分 {{ seconds % 60 }} 秒</span
    >
  </div>
  <AsyncState :loading="loading" :error="error" @retry="load">
    <div v-if="question" class="question-layout">
      <section class="panel">
        <div class="panel-heading">
          <div class="meta-row" style="margin: 0">
            <DataBadge :status="question.status" /><span>{{ question.subject }}</span
            ><span>{{ { single: '单选题', multiple: '多选题', boolean: '判断题' }[question.type] }}</span>
          </div>
          <button class="button secondary small" @click="favorite">
            <Bookmark :size="15" :fill="question.favorite ? 'currentColor' : 'none'" />{{
              question.favorite ? '已收藏' : '收藏'
            }}
          </button>
        </div>
        <RichText class="question-stem" :text="question.title" />
        <img
          v-if="question.imageUrl"
          :src="question.imageUrl"
          alt="题目配图"
          class="question-image"
          referrerpolicy="no-referrer"
        />
        <div role="group" aria-label="选择答案">
          <button
            v-for="option in question.options"
            :key="option.key"
            class="option"
            :class="{
              selected: answer.includes(option.key),
              correct: result?.correctAnswer.includes(option.key),
              incorrect:
                result &&
                !result.correct &&
                answer.includes(option.key) &&
                !result.correctAnswer.includes(option.key),
            }"
            :aria-pressed="answer.includes(option.key)"
            :disabled="!!result || busy"
            @click="choose(option.key)"
          >
            <span class="option-key">{{ option.key }}</span
            >{{ option.text }}
          </button>
        </div>
        <div class="actions mt">
          <button v-if="!result" class="button" :disabled="!answer.length || busy" @click="submit">
            {{ busy ? '正在提交…' : '提交答案' }}
</button
          ><button v-else class="button" @click="next">下一题 <ArrowRight :size="16" /></button
          ><span class="muted" style="font-size: 12px">{{
            question.type === 'multiple' ? '多选题，请选择所有正确选项。' : '提交后可查看解析。'
          }}</span>
        </div>
        <section v-if="result" class="answer-analysis" aria-live="polite">
          <h3>{{ result.correct ? '回答正确，继续保持。' : '这次没选对，把思路弄明白。' }}</h3>
          <p>正确答案：{{ result.correctAnswer.join('、') }} 你的答案：{{ result.answer.join('、') }}</p>
          <RichText class="mt" :text="result.explanation" />
        </section>
        <p class="muted mt" style="font-size: 11px">来源：{{ question.sourceLabel }}</p>
      </section>
      <aside class="stack question-side">
        <section class="panel">
          <h2>记下自己的理解</h2>
          <textarea
            v-model="note"
            aria-label="个人笔记"
            maxlength="10000"
            placeholder="记录这道题的关键思路…"
            @input="saved = false"
          ></textarea
          ><button class="button secondary w-full" @click="save">
            {{ saved ? '笔记已保存' : '保存笔记' }}
          </button>
        </section>
        <section class="panel">
          <div class="panel-heading">
            <h2>作答记录</h2>
            <span class="pill-number">最近 {{ history.length }} 次</span>
          </div>
          <p v-if="!history.length" class="muted">这是你与这道题的第一次相遇。</p>
          <details v-for="h in history" :key="h.id" class="mini-item">
            <summary style="cursor: pointer; font-size: 12px">
              {{ h.correct ? '正确' : '错误' }} · {{ new Date(h.createdAt).toLocaleDateString('zh-CN') }} ·
              {{ h.seconds }} 秒
            </summary>
            <p class="muted" style="font-size: 12px; margin-top: 10px">
              选择 {{ h.answer.join('、') }}；正确答案 {{ h.correctAnswer.join('、') }}
            </p>
            <p class="prose" style="font-size: 12px">{{ h.explanation }}</p>
          </details>
        </section>
      </aside>
    </div>
  </AsyncState>
</template>
