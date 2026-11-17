<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ArrowRight, BookOpen } from 'lucide-vue-next';
import type { PageMeta, SourcePaper, SourcePaperDetail } from '@zhian/contracts';
import { api, errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
import RichText from '../components/RichText.vue';
import { questionPreview, questionTypeLabels } from '../features/practice/content';
import { practiceQuestionLocation, readPracticeScope } from '../features/practice/scope';

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const error = ref('');
const papers = ref<SourcePaper[]>([]);
const paper = ref<SourcePaperDetail>();
const total = ref(0);
const keyword = ref('');
const subject = ref('');
const paperId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''));
const page = computed(() => {
  const value = typeof route.query.page === 'string' ? Number(route.query.page) : 1;
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
});
const pageSize = computed(() => (paperId.value ? 10 : 20));
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const paperScope = computed(() => readPracticeScope({ paperId: paperId.value, page: String(page.value) }));
const subjects = ['公务员·行测', '事业编·职测', '公务员·申论', '事业编·综应'];
let request: AbortController | undefined;

function navigate(nextPage = 1) {
  void router.push({
    path: paperId.value ? `/question-papers/${paperId.value}` : '/question-papers',
    query: {
      q: paperId.value ? undefined : keyword.value || undefined,
      subject: paperId.value ? undefined : subject.value || undefined,
      page: nextPage > 1 ? nextPage : undefined,
    },
  });
}
async function load() {
  request?.abort();
  const current = new AbortController();
  request = current;
  loading.value = true;
  error.value = '';
  keyword.value = typeof route.query.q === 'string' ? route.query.q : '';
  subject.value = typeof route.query.subject === 'string' ? route.query.subject : '';
  try {
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      q: keyword.value || undefined,
      subject: subject.value || undefined,
    };
    if (paperId.value) {
      const response = await api.get<{ data: SourcePaperDetail; meta: PageMeta }>(
        `/question-papers/${paperId.value}`,
        { params, signal: current.signal },
      );
      if (current.signal.aborted) return;
      paper.value = response.data.data;
      total.value = response.data.meta.total;
    } else {
      const response = await api.get<{ data: SourcePaper[]; meta: PageMeta }>('/question-papers', {
        params,
        signal: current.signal,
      });
      if (current.signal.aborted) return;
      papers.value = response.data.data;
      total.value = response.data.meta.total;
      paper.value = undefined;
    }
    if (page.value > pages.value)
      await router.replace({
        path: route.path,
        query: { ...route.query, page: pages.value > 1 ? String(pages.value) : undefined },
      });
  } catch (e) {
    if (!current.signal.aborted) error.value = errorText(e);
  } finally {
    if (!current.signal.aborted) loading.value = false;
  }
}
watch(() => route.fullPath, load, { immediate: true });
onBeforeUnmount(() => request?.abort());
</script>
<template>
  <div class="page-heading">
    <div>
      <RouterLink :to="paperId ? '/question-papers' : '/practice'" class="text-link mb"
        ><ArrowLeft :size="15" />{{ paperId ? '返回原卷题库' : '返回刷题中心' }}</RouterLink
      >
      <h1>{{ paperId ? paper?.title || '原卷详情' : '原卷题库' }}</h1>
      <p>{{ paperId ? '按原卷顺序阅读与练习。' : '按科目和试卷查找题目，也可阅读申论、综应材料。' }}</p>
    </div>
    <BookOpen :size="26" class="muted" />
  </div>
  <form v-if="!paperId" class="toolbar" @submit.prevent="navigate()">
    <label class="search-field"
      >试卷关键词<input v-model="keyword" maxlength="100" placeholder="年份、省份或试卷名称"
    /></label>
    <label
      >科目<select v-model="subject">
        <option value="">全部科目</option>
        <option v-for="item in subjects" :key="item">{{ item }}</option>
      </select></label
    >
    <button class="button" :disabled="loading">查找试卷</button>
  </form>
  <AsyncState
    :loading="loading"
    :error="error"
    :empty="!paperId && !papers.length"
    empty-text="没有找到符合条件的试卷"
    @retry="load"
  >
    <template v-if="paperId && paper">
      <div class="panel-heading">
        <div class="meta-row">
          <span>{{ paper.subject }}</span
          ><span>{{ paper.category }}</span
          ><span>{{ total }} 道题</span>
        </div>
        <RouterLink :to="{ path: '/practice', query: { paperId } }" class="button small"
          >按卷练习<ArrowRight :size="14"
        /></RouterLink>
      </div>
      <details v-for="(material, index) in paper.materials" :key="index" class="panel mb paper-material">
        <summary>{{ material.title || `阅读材料 ${index + 1}` }}</summary>
        <RichText class="mt" :text="material.text || '源材料未提供可展示的正文。'" />
      </details>
      <article v-for="item in paper.questions" :key="item.position" class="list-card">
        <div class="meta-row">
          <span>第 {{ item.position }} 题</span><span>{{ questionTypeLabels[item.type] }}</span>
        </div>
        <h2>{{ questionPreview(item.title) }}</h2>
        <div class="card-bottom">
          <span class="muted">{{ item.subject }}</span
          ><RouterLink :to="practiceQuestionLocation(paperScope, item.id)" class="button small"
            >{{ item.type === 'subjective' ? '阅读与自评' : '开始练习' }}<ArrowRight :size="14"
          /></RouterLink>
        </div>
      </article>
      <p v-if="!paper.questions.length" class="muted">这份原卷没有可展示的题目。</p>
    </template>
    <template v-else>
      <p class="muted mb">共 {{ total }} 套原卷</p>
      <article v-for="item in papers" :key="item.id" class="list-card">
        <div class="meta-row">
          <span>{{ item.subject }}</span
          ><span>{{ item.category }}</span
          ><span v-if="item.year">{{ item.year }} 年</span>
        </div>
        <h2>{{ item.title }}</h2>
        <div class="card-bottom">
          <span class="muted">{{ item.questionCount }} 道题目</span
          ><RouterLink :to="`/question-papers/${item.id}`" class="button small"
            >查看原卷<ArrowRight :size="14"
          /></RouterLink>
        </div>
      </article>
    </template>
    <div v-if="total" class="pagination">
      <button class="button secondary small" :disabled="page <= 1" @click="navigate(page - 1)">上一页</button>
      <span>{{ page }} / {{ pages }}</span>
      <button class="button secondary small" :disabled="page >= pages" @click="navigate(page + 1)">
        下一页
      </button>
    </div>
  </AsyncState>
</template>
<style scoped>
.paper-material {
  max-height: 520px;
  overflow: auto;
}
.paper-material summary {
  cursor: pointer;
  font-weight: 600;
}
.list-card h2 {
  line-height: 1.7;
}
</style>
