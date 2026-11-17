<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Bookmark, ArrowRight, ArrowLeft, Clock3 } from 'lucide-vue-next';
import { ElMessage } from 'element-plus';
import type { Question, AnswerResult } from '@zhian/contracts';
import { errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
import DataBadge from '../components/DataBadge.vue';
import RichText from '../components/RichText.vue';
import AiResult from '../features/ai/AiResult.vue';
import { generateQuestionExplanation } from '../features/ai/api';
import { questionTypeLabels } from '../features/practice/content';
import {
  fetchPracticeQuestion,
  findNextQuestion,
  setQuestionFavorite,
  setQuestionNote,
  submitPracticeAnswer,
  revealQuestionSolution,
} from '../features/practice/api';
import {
  practiceListLocation,
  practiceQuestionLocation,
  readPracticeScope,
} from '../features/practice/scope';
const route = useRoute(),
  router = useRouter(),
  questionId = String(route.params.id),
  question = ref<Question>(),
  loading = ref(true),
  error = ref(''),
  answer = ref<string[]>([]),
  result = ref<AnswerResult>(),
  solution = ref<string>(),
  history = ref<AnswerResult[]>([]),
  note = ref(''),
  busy = ref(false),
  seconds = ref(0),
  saved = ref(false),
  key = crypto.randomUUID();
const scope = computed(() => readPracticeScope(route.query));
const back = computed(() => practiceListLocation(scope.value));
const backTitle = computed(() =>
  scope.value.mode === 'wrong'
    ? '返回错题复盘'
    : scope.value.mode === 'favorite'
      ? '返回题目收藏'
      : '返回刷题中心',
);
const changingFavorite = ref(false);
const savingNote = ref(false);
let timer: ReturnType<typeof setInterval>;
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const details = await fetchPracticeQuestion(questionId, scope.value.paperId);
    question.value = details.question;
    history.value = details.history;
    note.value = details.question.note ?? '';
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
  if (!answer.value.length || busy.value) return;
  busy.value = true;
  try {
    const record = await submitPracticeAnswer(questionId, answer.value, seconds.value, key);
    result.value = record;
    history.value.unshift(record);
  } catch (e) {
    ElMessage.error(errorText(e));
  } finally {
    busy.value = false;
  }
}
async function reveal() {
  if (busy.value) return;
  busy.value = true;
  try {
    solution.value = (await revealQuestionSolution(questionId)).explanation;
  } catch (e) {
    ElMessage.error(errorText(e));
  } finally {
    busy.value = false;
  }
}
async function favorite() {
  const current = question.value;
  if (!current || changingFavorite.value) return;
  changingFavorite.value = true;
  try {
    current.favorite = await setQuestionFavorite(questionId, !current.favorite);
  } catch (e) {
    ElMessage.error(errorText(e));
  } finally {
    changingFavorite.value = false;
  }
}
async function save() {
  if (savingNote.value) return;
  const content = note.value;
  savingNote.value = true;
  try {
    await setQuestionNote(questionId, content);
    saved.value = note.value === content;
    ElMessage.success('笔记已保存');
  } catch (e) {
    ElMessage.error(errorText(e));
  } finally {
    savingNote.value = false;
  }
}
async function next() {
  if (busy.value) return;
  const from = route.fullPath;
  const currentScope = scope.value;
  busy.value = true;
  try {
    const target = await findNextQuestion(currentScope, questionId);
    if (route.fullPath !== from) return;
    if (target) await router.push(practiceQuestionLocation(currentScope, target.id));
    else ElMessage.info('当前范围已没有下一题。');
  } catch (e) {
    ElMessage.error(errorText(e));
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  void load();
  timer = setInterval(() => {
    if (
      !result.value &&
      solution.value === undefined &&
      !loading.value &&
      document.visibilityState === 'visible'
    )
      seconds.value++;
  }, 1000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>
<template>
  <div class="page-heading">
    <div>
      <RouterLink class="text-link mb" :to="back"><ArrowLeft :size="15" />{{ backTitle }}</RouterLink>
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
            ><span>{{ questionTypeLabels[question.type] }}</span>
          </div>
          <button class="button secondary small" :disabled="changingFavorite" @click="favorite">
            <Bookmark :size="15" :fill="question.favorite ? 'currentColor' : 'none'" />{{
              question.favorite ? '已收藏' : '收藏'
            }}
          </button>
        </div>
        <details v-if="question.material" class="question-material mb" open>
          <summary>阅读材料</summary>
          <RichText class="mt" :text="question.material" />
        </details>
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
            <span class="option-key">{{ option.key }}</span>
            <RichText :text="option.text" />
          </button>
        </div>
        <div class="actions mt">
          <button
            v-if="question.type === 'subjective' && solution === undefined"
            class="button"
            :disabled="busy"
            @click="reveal"
          >
            {{ busy ? '正在加载…' : '查看参考解析' }}
          </button>
          <button
            v-else-if="question.type !== 'subjective' && !result"
            class="button"
            :disabled="!answer.length || busy"
            @click="submit"
          >
            {{ busy ? '正在提交…' : '提交答案' }}
          </button>
          <button v-else class="button" :disabled="busy" @click="next">
            <span>下一题</span> <ArrowRight :size="16" />
          </button>
          <span class="muted" style="font-size: 12px">{{
            question.type === 'subjective'
              ? '阅读与自评，可将作答思路记入笔记。'
              : question.type === 'multiple'
                ? '多选题，请选择所有正确选项。'
                : '提交后可查看解析。'
          }}</span>
        </div>
        <section v-if="result" class="answer-analysis" aria-live="polite">
          <h3>{{ result.correct ? '回答正确，继续保持。' : '这次没选对，把思路弄明白。' }}</h3>
          <p>正确答案：{{ result.correctAnswer.join('、') }} 你的答案：{{ result.answer.join('、') }}</p>
          <RichText class="mt" :text="result.explanation" />
        </section>
        <section v-if="solution !== undefined" class="answer-analysis" aria-live="polite">
          <h3>参考解析</h3>
          <RichText class="mt" :text="solution || '源题未提供参考解析。'" />
        </section>
        <AiResult
          v-if="result"
          title="AI 解析"
          action="生成 AI 解析"
          disclosure="生成时会向 AI 网关发送题干、选项、本次选择及对错、正确答案和题库解析。"
          :unavailable-reason="
            question.imageUrl ||
            /!\[/.test(question.title + question.material + question.options.map((o) => o.text).join(''))
              ? '这道题含配图，可查看上方题库解析。'
              : undefined
          "
          :generate="(signal) => generateQuestionExplanation(questionId, result!.id, signal)"
        />
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
          ><button class="button secondary w-full" :disabled="savingNote" @click="save">
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
            <RichText style="font-size: 12px" :text="h.explanation" />
          </details>
        </section>
      </aside>
    </div>
  </AsyncState>
</template>
<style scoped>
.question-material {
  padding: 18px;
  background: var(--surface-muted, #f4f5f0);
  border-radius: 8px;
  max-height: 560px;
  overflow: auto;
}
.question-material summary {
  cursor: pointer;
  font-weight: 600;
}
.option :deep(.rich-text) {
  min-width: 0;
  text-align: left;
}
</style>
