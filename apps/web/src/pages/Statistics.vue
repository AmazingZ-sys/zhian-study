<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Overview, DailyStat, SubjectStat, Exam } from '@zhian/contracts';
import { api, typedApi, errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
import StudyChart from '../components/StudyChart.vue';
const loading = ref(true),
  error = ref(''),
  overview = ref<Overview>(),
  daily = ref<DailyStat[]>([]),
  subjects = ref<SubjectStat[]>([]),
  exams = ref<Exam[]>([]);
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [a, b, c, d] = await Promise.all([
      typedApi('/statistics/overview', 'get'),
      typedApi('/statistics/daily', 'get'),
      typedApi('/statistics/subjects', 'get'),
      api.get('/exams', { params: { pageSize: 100 } }),
    ]);
    overview.value = a.data;
    daily.value = b.data;
    subjects.value = c.data;
    exams.value = d.data.data.filter((x: Exam) => x.status === 'submitted').reverse();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">SMALL STEPS, REAL PROGRESS</div>
      <h1>让进步，有迹可循。</h1>
      <p>来自你的真实练习和考试记录，按北京时间统计。</p>
    </div>
  </div>
  <AsyncState :loading="loading" :error="error" @retry="load">
    <template v-if="overview">
      <div class="stats-grid">
        <div
          v-for="item in [
            ['累计答题', overview.total, '题'],
            ['整体正确率', overview.accuracy, '%'],
            ['学习时长', Math.round(overview.seconds / 60), '分钟'],
            ['待复盘错题', overview.wrong, '题'],
          ]"
          :key="String(item[0])"
          class="stat-card"
        >
          <p class="muted">{{ item[0] }}</p>
          <div class="stat-number">
            {{ item[1] }}<span>{{ item[2] }}</span>
          </div>
        </div>
      </div>
      <div class="dashboard-grid">
        <section class="panel">
          <div class="panel-heading">
            <h2>近 30 天学习趋势</h2>
            <span class="section-note">题 / 天</span>
          </div>
          <StudyChart
            v-if="daily.length"
            :labels="daily.map((d) => d.date.slice(5))"
            :values="daily.map((d) => d.total)"
          /><AsyncState v-else empty empty-text="完成练习后，趋势会从这里生长" />
        </section>
        <section class="panel">
          <h2 class="mb">薄弱点观察</h2>
          <p v-if="!subjects.length" class="muted">需要一些真实作答记录，才能给出有依据的复盘建议。</p>
          <div
            v-for="s in [...subjects].sort((a, b) => a.accuracy - b.accuracy)"
            :key="s.subject"
            class="mini-item"
          >
            <div class="actions" style="justify-content: space-between">
              <h3>{{ s.subject }}</h3>
              <span>{{ s.accuracy }}%</span>
            </div>
            <div class="progress-track"><span :style="{ width: s.accuracy + '%' }"></span></div>
            <p class="muted" style="font-size: 12px">
              答对 {{ s.correct }} / {{ s.total }} 题 ·
              {{ s.total < 10 ? '样本较少，继续积累' : s.accuracy < 60 ? '建议重点复盘' : '保持练习' }}
            </p>
          </div>
        </section>
        <section class="panel">
          <h2 class="mb">每日错题变化</h2>
          <StudyChart
            v-if="daily.length"
            :labels="daily.map((d) => d.date.slice(5))"
            :values="daily.map((d) => d.wrong)"
            name="当日答错题数"
            bar
          />
          <p v-else class="muted">尚无答题数据</p>
        </section>
        <section class="panel">
          <h2 class="mb">模拟考试成绩</h2>
          <StudyChart
            v-if="exams.length"
            :labels="exams.map((e, i) => '第' + (i + 1) + '次')"
            :values="exams.map((e) => e.score ?? 0)"
            name="考试得分"
          />
          <p v-else class="muted">完成一场模拟考试后查看成绩走势。不同试卷满分可能不同，请结合报告比较。</p>
          <RouterLink
            v-for="e in exams.slice(-3)"
            :key="e.id"
            :to="'/exams/' + e.id + '/result'"
            class="mini-item"
            style="display: block; font-size: 12px"
            >{{ e.title }} · {{ e.score }} 分</RouterLink
          >
        </section>
      </div>
    </template>
  </AsyncState>
</template>
