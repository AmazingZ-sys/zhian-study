<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import type { Exam, Category, PageMeta } from '@zhian/contracts';
import { ElMessage } from 'element-plus';
import { ArrowRight, Plus } from 'lucide-vue-next';
import { api, errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
const router = useRouter(),
  rows = ref<Exam[]>([]),
  categories = ref<Category[]>([]),
  loading = ref(true),
  error = ref(''),
  creating = ref(false),
  show = ref(false),
  count = ref(10),
  minutes = ref(30),
  points = ref(5),
  title = ref('我的模拟考试'),
  categoryId = ref(''),
  page = ref(1),
  meta = ref<PageMeta>({ total: 0, page: 1, pageSize: 10 });
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [a, b] = await Promise.all([
      api.get('/exams', { params: { page: page.value, pageSize: 10 } }),
      api.get('/question-categories'),
    ]);
    rows.value = a.data.data;
    meta.value = a.data.meta;
    categories.value = b.data.data;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
async function create() {
  creating.value = true;
  try {
    const { data } = await api.post('/exams', {
      title: title.value,
      count: count.value,
      minutes: minutes.value,
      points: points.value,
      categoryId: categoryId.value || undefined,
    });
    await router.push('/exams/' + data.data.id);
  } catch (e) {
    ElMessage.error(errorText(e));
  } finally {
    creating.value = false;
  }
}
onMounted(load);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">MAKE ROOM FOR A REAL CHALLENGE</div>
      <h1>把每次模拟，当作一次成长。</h1>
      <p>服务器计时 · 自动保存答案 · 交卷后查看逐题解析</p>
    </div>
    <button class="button" @click="show = !show"><Plus :size="16" />创建模拟考试</button>
  </div>
  <section v-if="show" class="panel mb">
    <h2 class="mb">安排一场自己的考试</h2>
    <form class="form-grid" @submit.prevent="create">
      <label>考试名称<input v-model="title" maxlength="100" required /></label
      ><label
        >题目范围<select v-model="categoryId">
          <option value="">全部科目</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">
            {{ c.subject }} · {{ c.name }}（{{ c.count }} 题）
          </option>
        </select></label
      ><label>题目数量<input v-model.number="count" type="number" min="1" max="100" required /></label
      ><label
        >考试时长（分钟）<input v-model.number="minutes" type="number" min="1" max="180" required /></label
      ><label>每题分值<input v-model.number="points" type="number" min="1" max="100" required /></label>
      <div class="actions">
        <button class="button" :disabled="creating">
          {{ creating ? '正在组卷…' : '开始考试' }}<ArrowRight :size="16" />
</button
        ><button type="button" class="button ghost" @click="show = false">取消</button>
      </div>
    </form>
    <p class="muted mt">创建后立即开始计时；题库数量不足时会提示调整，不会重复凑题。</p>
  </section>
  <AsyncState
    :loading="loading"
    :error="error"
    :empty="!rows.length"
    empty-text="还没有模拟考试记录"
    @retry="load"
  >
    <article v-for="exam in rows" :key="exam.id" class="list-card">
      <div class="list-card-head">
        <div>
          <span class="badge" :class="exam.status === 'active' ? 'pending' : 'verified'">{{
            exam.status === 'active' ? '进行中' : '已完成'
          }}</span>
          <h2 style="margin-top: 12px">{{ exam.title }}</h2>
          <p class="meta-row">{{ new Date(exam.startedAt).toLocaleString('zh-CN') }}</p>
        </div>
        <div v-if="exam.score !== null" class="stat-number">{{ exam.score }}<span>分</span></div>
      </div>
      <div class="card-bottom">
        <span class="muted" style="font-size: 12px">{{
          exam.status === 'active' ? '答案已保存，可继续作答' : '成绩与解析已生成'
        }}</span
        ><RouterLink
          class="button small"
          :to="'/exams/' + exam.id + (exam.status === 'submitted' ? '/result' : '')"
          >{{ exam.status === 'active' ? '继续考试' : '查看报告' }}<ArrowRight :size="14"
        /></RouterLink>
      </div>
    </article>
    <div class="pagination">
      <button
        class="button secondary"
        :disabled="page === 1"
        @click="
          page--;
          load();
        "
      >
        上一页
</button
      ><span>{{ page }}</span
      ><button
        class="button secondary"
        :disabled="page * 10 >= meta.total"
        @click="
          page++;
          load();
        "
      >
        下一页
      </button>
    </div>
  </AsyncState>
</template>
