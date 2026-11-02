<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Target,
  Clock3,
  Flame,
  Languages,
  Shapes,
  Calculator,
  ChartColumn,
  Lightbulb,
  ChevronRight,
} from 'lucide-vue-next';
import type { Overview, Category, Job, DailyStat, Announcement } from '@zhian/contracts';
import { api, errorText } from '../api';
import { useAuth } from '../stores/auth';
import AsyncState from '../components/AsyncState.vue';
import DataBadge from '../components/DataBadge.vue';
import StudyChart from '../components/StudyChart.vue';
const auth = useAuth(),
  loading = ref(true),
  error = ref(''),
  overview = ref<Overview>(),
  categories = ref<Category[]>([]),
  jobs = ref<Job[]>([]),
  daily = ref<DailyStat[]>([]),
  announcements = ref<Announcement[]>([]);
const icons = [Lightbulb, Languages, Calculator, Shapes, ChartColumn];
const date = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
  timeZone: 'Asia/Shanghai',
}).format(new Date());
const goal = computed(() =>
  overview.value ? Math.min(100, Math.round((overview.value.today / overview.value.dailyGoal) * 100)) : 0,
);
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [a, b, c, d, e] = await Promise.all([
      api.get('/statistics/overview'),
      api.get('/question-categories'),
      api.get('/jobs', { params: { pageSize: 3 } }),
      api.get('/statistics/daily'),
      api.get('/announcements', { params: { pageSize: 2 } }),
    ]);
    overview.value = a.data.data;
    categories.value = b.data.data;
    jobs.value = c.data.data;
    daily.value = d.data.data;
    announcements.value = e.data.data;
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
      <div class="eyebrow">YOUR PERSONAL STUDY SPACE</div>
      <h1>{{ auth.user?.name }}，今天也一起向前。</h1>
      <p>把目标放在心里，把进步留在每一天。</p>
    </div>
    <span class="muted" style="font-size: 12px; padding-top: 10px">{{ date }}</span>
  </div>
  <AsyncState :loading="loading" :error="error" @retry="load">
    <template v-if="overview">
      <section class="hero">
        <div class="hero-content">
          <div class="eyebrow">一步一程 · 日积月累</div>
          <h1>不必追赶别人的进度，<br />只管走好自己的路。</h1>
          <p>
            {{ auth.profile?.targetYear }} {{ auth.profile?.province || '全国' }} ·
            {{ auth.profile?.examType || '公考' }}备考计划，从今天的一次练习开始。
          </p>
          <RouterLink to="/practice" class="button">开始今日练习 <ArrowRight :size="16" /></RouterLink>
        </div>
        <div class="hero-art" aria-hidden="true">
          <i class="art-ring"></i><i class="art-ring"></i><i class="art-ring"></i><i class="art-sail"></i
          ><i class="art-water"></i><small>ON YOUR WAY</small>
        </div>
      </section>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-top">累计答题<BookOpen :size="17" /></div>
          <div class="stat-number">{{ overview.total }}<span>题</span></div>
          <div class="stat-foot">每一道，都是积累</div>
        </div>
        <div class="stat-card">
          <div class="stat-top">答题正确率<Target :size="17" /></div>
          <div class="stat-number">{{ overview.accuracy }}<span>%</span></div>
          <div class="stat-foot">已答对 {{ overview.correct }} 道题</div>
        </div>
        <div class="stat-card">
          <div class="stat-top">累计学习<Clock3 :size="17" /></div>
          <div class="stat-number">{{ Math.round(overview.seconds / 60) }}<span>分钟</span></div>
          <div class="stat-foot">来自实际答题与考试记录</div>
        </div>
        <div class="stat-card">
          <div class="stat-top">连续学习<Flame :size="17" /></div>
          <div class="stat-number">{{ overview.streak }}<span>天</span></div>
          <div class="stat-foot">保持自己的节奏</div>
        </div>
      </div>
      <div class="dashboard-grid">
        <div class="stack">
          <section class="panel">
            <div class="panel-heading">
              <h2>从一个专项开始</h2>
              <RouterLink to="/practice" class="text-link">全部练习 <ArrowUpRight :size="15" /></RouterLink>
            </div>
            <div class="practice-grid">
              <RouterLink
                v-for="(c, i) in categories"
                :key="c.id"
                :to="{ path: '/practice', query: { categoryId: c.id } }"
                class="practice-tile"
                ><span class="tile-icon"><component :is="icons[i % icons.length]" :size="21" /></span
                ><strong>{{ c.subject }}</strong
                ><small>{{ c.name }} · {{ c.count }} 题</small></RouterLink
              ><RouterLink to="/wrong" class="practice-tile"
                ><span class="tile-icon"><BookOpen :size="21" /></span><strong>错题再练</strong
                ><small>{{ overview.wrong }} 道待复盘</small></RouterLink
              >
            </div>
          </section>
          <section class="panel">
            <div class="panel-heading">
              <h2>看得见的进步</h2>
              <span class="section-note">近 30 天 · 答题数量</span>
            </div>
            <StudyChart
              v-if="daily.length"
              :labels="daily.map((d) => d.date.slice(5))"
              :values="daily.map((d) => d.total)"
            />
            <div v-else class="state-box" style="min-height: 205px">
              <p>还没有学习记录。完成一道题，留下第一个足迹。</p>
              <RouterLink class="text-link" to="/practice">开始积累 <ArrowRight :size="14" /></RouterLink>
            </div>
          </section>
          <section class="panel">
            <div class="panel-heading">
              <h2>招考资讯</h2>
              <RouterLink to="/announcements" class="text-link"
                >查看全部 <ArrowUpRight :size="15"
              /></RouterLink>
            </div>
            <div v-if="!announcements.length" class="muted">暂无已发布公告</div>
            <RouterLink
              v-for="a in announcements"
              :key="a.id"
              :to="'/announcements/' + a.id"
              class="mini-item"
              style="display: block"
              ><h3>{{ a.title }}</h3>
              <p>
                <DataBadge :status="a.status" /><span>{{ a.type }}</span
                ><span>{{ a.province }}</span>
              </p></RouterLink
            >
          </section>
        </div>
        <div class="stack">
          <section class="panel">
            <div class="panel-heading">
              <h2>今日小目标</h2>
              <RouterLink to="/profile" class="text-link">调整目标</RouterLink>
            </div>
            <div class="goal-layout">
              <div class="goal-ring">
                <strong>{{ overview.today }}</strong
                ><span>/ {{ overview.dailyGoal }} 题</span>
              </div>
              <div class="goal-copy">
                <p>{{ goal >= 100 ? '今天的目标已达成' : '让坚持变得简单' }}</p>
                <small>{{ goal >= 100 ? '给自己一点肯定。' : '不求一步到位，做好今天这一步。' }}</small>
              </div>
            </div>
            <div
              class="progress-track"
              role="progressbar"
              :aria-valuenow="goal"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-label="今日学习进度"
            >
              <span :style="{ width: goal + '%' }"></span>
            </div>
            <div class="stat-foot">今日目标已完成 {{ goal }}%</div>
          </section>
          <section class="panel">
            <div class="panel-heading">
              <h2>探索新的可能</h2>
              <RouterLink class="text-link" to="/jobs"
                ><ArrowUpRight :size="17" /><span class="sr-only">查看岗位</span></RouterLink
              >
            </div>
            <p class="muted" style="font-size: 12px; margin-bottom: 18px">把学习之外的选择，也看清楚。</p>
            <div class="mini-list">
              <RouterLink v-for="job in jobs" :key="job.id" :to="'/jobs/' + job.id" class="mini-item"
                ><div class="actions" style="justify-content: space-between">
                  <DataBadge :status="job.status" /><ChevronRight :size="14" />
                </div>
                <h3 style="margin-top: 9px">{{ job.title }}</h3>
                <p>{{ job.organization }}</p>
                <p>
                  <span>{{ job.province }} · {{ job.city }}</span
                  ><span>{{ job.education }}</span
                  ><span>招 {{ job.headcount }} 人</span>
                </p></RouterLink
              >
              <p v-if="!jobs.length" class="muted">暂无已发布岗位</p>
            </div>
            <RouterLink class="button secondary w-full mt" to="/jobs"
              >前往岗位库 <ArrowRight :size="15"
            /></RouterLink>
          </section>
          <div class="notice" style="margin-bottom: 0">
            认真核对，安心选择。<br />演示岗位不是真实招录信息，报考条件请以官方公告为准。
          </div>
        </div>
      </div>
    </template>
  </AsyncState>
</template>
