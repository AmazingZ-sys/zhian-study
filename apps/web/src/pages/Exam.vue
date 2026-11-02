<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, ArrowRight, Clock3 } from 'lucide-vue-next';
import type { Exam } from '@zhian/contracts';
import { api, errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
import RichText from '../components/RichText.vue';
const route = useRoute(),
  router = useRouter(),
  exam = ref<Exam>(),
  loading = ref(true),
  error = ref(''),
  index = ref(0),
  busy = ref(false),
  saveError = ref(''),
  remaining = ref(0),
  now = ref(Date.now()),
  offset = ref(0);
let timer: ReturnType<typeof setInterval>;
const question = computed(() => exam.value?.questions[index.value]);
const answered = computed(() => exam.value?.questions.filter((q) => q.answer.length).length ?? 0);
const correct = computed(() => exam.value?.questions.filter((q) => q.correct).length ?? 0);
const subjects = computed(() => {
  const map = new Map<string, { total: number; correct: number }>();
  for (const q of exam.value?.questions ?? []) {
    const s = map.get(q.subject) ?? { total: 0, correct: 0 };
    s.total++;
    if (q.correct) s.correct++;
    map.set(q.subject, s);
  }
  return [...map.entries()];
});
async function load() {
  loading.value = true;
  error.value = '';
  try {
    exam.value = (await api.get('/exams/' + route.params.id)).data.data;
    offset.value = new Date(exam.value!.serverNow).getTime() - Date.now();
    tick();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
function tick() {
  now.value = Date.now() + offset.value;
  remaining.value = Math.max(
    0,
    Math.ceil((new Date(exam.value?.deadline ?? now.value).getTime() - now.value) / 1000),
  );
  if (exam.value?.status === 'active' && remaining.value === 0 && !busy.value) void submit(true);
}
async function choose(key: string) {
  if (!question.value || busy.value || exam.value?.status !== 'active') return;
  const q = question.value;
  const next =
    q.type === 'multiple'
      ? q.answer.includes(key)
        ? q.answer.filter((k) => k !== key)
        : [...q.answer, key]
      : [key];
  busy.value = true;
  saveError.value = '';
  try {
    await api.patch('/exams/' + exam.value.id + '/answers', { questionId: q.id, answer: next });
    q.answer = next;
  } catch (e) {
    saveError.value = errorText(e) + '；本次选择未保存，请重试。';
    if ((e as { status?: number }).status === 409) await load();
  } finally {
    busy.value = false;
  }
}
async function submit(auto = false) {
  if (busy.value) return;
  if (!auto) {
    try {
      await ElMessageBox.confirm(
        `已作答 ${answered.value}/${exam.value?.total} 题。确定交卷吗？交卷后不能修改。`,
        '提交试卷',
        { confirmButtonText: '确认交卷', cancelButtonText: '继续作答' },
      );
    } catch {
      return;
    }
  }
  busy.value = true;
  try {
    exam.value = (await api.post('/exams/' + route.params.id + '/submit')).data.data;
    ElMessage.success(auto ? '考试时间结束，已自动交卷' : '试卷已提交');
    await router.replace('/exams/' + route.params.id + '/result');
  } catch (e) {
    saveError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
onBeforeRouteLeave(async () => {
  if (exam.value?.status === 'active') {
    try {
      await ElMessageBox.confirm('答案已保存，但离开后考试仍会继续计时。确定离开吗？', '离开考场', {
        confirmButtonText: '离开',
        cancelButtonText: '继续考试',
      });
      return true;
    } catch {
      return false;
    }
  }
  return true;
});
const beforeUnload = (e: BeforeUnloadEvent) => {
  if (exam.value?.status === 'active') {
    e.preventDefault();
    e.returnValue = '';
  }
};
onMounted(() => {
  void load();
  timer = setInterval(tick, 1000);
  window.addEventListener('beforeunload', beforeUnload);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>
<template>
  <div class="page-heading">
    <div>
      <RouterLink to="/exams" class="text-link mb"><ArrowLeft :size="15" />返回模拟考场</RouterLink>
      <h1>{{ exam?.title ?? '模拟考试' }}</h1>
      <p>
        {{
          exam?.status === 'submitted'
            ? '每一次复盘，都让下一次更从容。'
            : '答案保存成功后才更新选择，时间以服务器为准。'
        }}
      </p>
    </div>
  </div>
  <AsyncState :loading="loading" :error="error" @retry="load">
    <template v-if="exam">
      <section v-if="exam.status === 'submitted'" class="panel mb">
        <div class="page-heading" style="margin: 0">
          <div>
            <div class="eyebrow">YOUR EXAM REPORT</div>
            <div class="score-large">
              {{ exam.score }}<small> / {{ exam.total * exam.points }} 分</small>
            </div>
            <p class="muted mt">
              正确 {{ correct }} 题 · 错误 {{ exam.total - correct }} 题 · 正确率
              {{ Math.round((correct / exam.total) * 100) }}%
            </p>
            <p class="muted">
              作答 {{ answered }} / {{ exam.total }} 题 · 用时
              {{
                Math.round(
                  (new Date(exam.submittedAt!).getTime() - new Date(exam.startedAt).getTime()) / 60000,
                )
              }}
              分钟
            </p>
          </div>
          <div>
            <h3 class="mb">科目表现</h3>
            <p v-for="[name, s] in subjects" :key="name" class="meta-row">
              {{ name }}：{{ s.correct }}/{{ s.total }}
              <span v-if="s.correct / s.total < 0.6" class="badge pending">建议重点复盘</span>
            </p>
            <RouterLink to="/statistics" class="text-link"
              >查看历史成绩与学习趋势 <ArrowRight :size="15"
            /></RouterLink>
          </div>
        </div>
      </section>
      <div class="question-layout">
        <section v-if="question" class="panel">
          <div class="panel-heading">
            <span class="badge">{{ question.subject }} · 第 {{ index + 1 }} / {{ exam.total }} 题</span
            ><span class="muted"
              >{{ { single: '单选', multiple: '多选', boolean: '判断' }[question.type] }} ·
              {{ exam.points }} 分</span
            >
          </div>
          <RichText class="question-stem" :text="question.title" />
          <img v-if="question.imageUrl" :src="question.imageUrl" alt="题目配图" class="question-image" />
          <div role="group" aria-label="考试答案">
            <button
              v-for="o in question.options"
              :key="o.key"
              class="option"
              :class="{
                selected: question.answer.includes(o.key),
                correct: question.correctAnswer?.includes(o.key),
              }"
              :aria-pressed="question.answer.includes(o.key)"
              :disabled="busy || exam.status === 'submitted'"
              @click="choose(o.key)"
            >
              <span class="option-key">{{ o.key }}</span
              >{{ o.text }}
            </button>
          </div>
          <p v-if="saveError" class="form-error" role="alert">{{ saveError }}</p>
          <p v-else-if="exam.status === 'active'" class="muted" aria-live="polite">
            {{ busy ? '正在保存…' : '所有已选答案均已保存' }}
          </p>
          <div v-if="exam.status === 'submitted'" class="answer-analysis">
            <h3>{{ question.correct ? '回答正确' : '需要复盘' }}</h3>
            <p>
              你的答案：{{ question.answer.join('、') || '未作答' }} 正确答案：{{
                question.correctAnswer?.join('、')
              }}
            </p>
            <RichText class="mt" :text="question.explanation ?? ''" />
          </div>
          <div class="actions mt">
            <button class="button secondary" :disabled="index === 0 || busy" @click="index--">
              <ArrowLeft :size="15" />上一题
</button
            ><button class="button" :disabled="index === exam.total - 1 || busy" @click="index++">
              下一题<ArrowRight :size="15" />
            </button>
          </div>
        </section>
        <aside class="panel">
          <template v-if="exam.status === 'active'">
            <p class="actions muted"><Clock3 :size="16" />剩余时间</p>
            <div class="countdown mt">
              {{ String(Math.floor(remaining / 60)).padStart(2, '0') }}:{{
                String(remaining % 60).padStart(2, '0')
              }}
            </div>
          </template>
          <h2 class="mt">答题卡</h2>
          <p class="muted">已作答 {{ answered }} / {{ exam.total }}</p>
          <div class="answer-card">
            <button
              v-for="(q, i) in exam.questions"
              :key="q.id"
              :class="{ done: q.answer.length, current: index === i }"
              :aria-label="`第 ${i + 1} 题${q.answer.length ? '已作答' : '未作答'}`"
              :disabled="busy"
              @click="index = i"
            >
              {{ i + 1 }}
            </button>
          </div>
          <button v-if="exam.status === 'active'" class="button w-full" :disabled="busy" @click="submit()">
            提交试卷
          </button>
          <p class="muted mt" style="font-size: 12px">
            {{
              exam.status === 'active'
                ? '刷新或离开页面不会暂停计时。超时后由服务器结算。'
                : '点击题号查看每道题的答案与解析。'
            }}
          </p>
        </aside>
      </div>
    </template>
  </AsyncState>
</template>
