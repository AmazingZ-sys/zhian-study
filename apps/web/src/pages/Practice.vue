<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRight, BookOpen } from 'lucide-vue-next';
import type { Question, Category, CategoryProgress } from '@zhian/contracts';
import { ElMessage } from 'element-plus';
import { errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
import DataBadge from '../components/DataBadge.vue';
import { questionPreview, questionTypeLabels } from '../features/practice/content';
import PracticeCatalog from '../features/practice/PracticeCatalog.vue';
import {
  fetchCategories,
  fetchCategoryProgress,
  fetchPracticeList,
  setQuestionMastered,
} from '../features/practice/api';
import {
  practiceListLocation,
  practiceModes,
  practicePageSize,
  practiceQuestionLocation,
  readPracticeScope,
  type BrowseMode,
  type PracticeScope,
} from '../features/practice/scope';

const route = useRoute();
const router = useRouter();
const listPath = route.path;
const wrong = listPath === '/wrong';
const favorite = listPath === '/favorites';
const showCatalog = !wrong && !favorite;
const scope = computed(() => readPracticeScope(route.query, listPath));
const draft = ref({ ...scope.value });
const rows = ref<Question[]>([]);
const total = ref(0);
const loading = ref(true);
const error = ref('');
const categories = ref<Category[]>([]);
const catalog = ref<CategoryProgress[]>([]);
const catalogLoading = ref(true);
const catalogError = ref('');
const selectedCategory = computed(() =>
  catalog.value.find((category) => category.id === scope.value.categoryId),
);
const selectedScopeLabel = computed(() => {
  const category = selectedCategory.value;
  if (!category) return '已按章节筛选';
  if (scope.value.includeDescendants) return `${category.name}（含下级）`;
  const hasChildren = catalog.value.some(
    (child) => child.parentId === category.id && child.id !== category.id,
  );
  return hasChildren ? `${category.name}（仅本章节）` : category.name;
});
const lastPage = computed(() => Math.max(1, Math.ceil(total.value / practicePageSize)));
const pendingMastery = ref(new Set<string>());
const catalogRequest = new AbortController();
let listRequest: AbortController | undefined;

async function load() {
  listRequest?.abort();
  const request = new AbortController();
  listRequest = request;
  const applied = scope.value;
  loading.value = true;
  error.value = '';
  try {
    const { data, meta } = await fetchPracticeList(applied, request.signal);
    if (request.signal.aborted) return;
    rows.value = data;
    total.value = meta.total;
    if (applied.page > lastPage.value)
      await router.replace(practiceListLocation({ ...applied, page: lastPage.value }));
  } catch (e) {
    if (!request.signal.aborted) error.value = errorText(e);
  } finally {
    if (!request.signal.aborted) loading.value = false;
  }
}

async function loadCatalog() {
  catalogLoading.value = true;
  catalogError.value = '';
  try {
    if (showCatalog) catalog.value = await fetchCategoryProgress(catalogRequest.signal);
    else categories.value = await fetchCategories(catalogRequest.signal);
  } catch (e) {
    if (!catalogRequest.signal.aborted) catalogError.value = errorText(e);
  } finally {
    if (!catalogRequest.signal.aborted) catalogLoading.value = false;
  }
}

async function mark(id: string) {
  if (pendingMastery.value.has(id)) return;
  pendingMastery.value.add(id);
  try {
    await setQuestionMastered(id, scope.value.mastered !== 'true');
    ElMessage.success('已更新掌握状态');
    if (!catalogRequest.signal.aborted) await load();
  } catch (e) {
    ElMessage.error(errorText(e));
  } finally {
    pendingMastery.value.delete(id);
  }
}

function navigate(next: PracticeScope) {
  const location = practiceListLocation(next);
  if (router.resolve(location).fullPath === route.fullPath) void load();
  else void router.push(location);
}

function selectMode(mode: BrowseMode) {
  navigate({ ...draft.value, mode, year: mode === 'past' ? draft.value.year : '', page: 1 });
}

function selectCategory(categoryId: string, includeDescendants: boolean) {
  navigate({ ...draft.value, categoryId, includeDescendants, page: 1 });
}

watch(
  () => (route.path === listPath ? route.query : undefined),
  (query) => {
    if (!query) return;
    draft.value = { ...scope.value };
    void load();
  },
  { immediate: true },
);
onMounted(loadCatalog);
onBeforeUnmount(() => {
  listRequest?.abort();
  catalogRequest.abort();
});
</script>
<template>
  <div class="page-heading">
    <h1>{{ wrong ? '错题复盘' : favorite ? '题目收藏' : '刷题中心' }}</h1>
    <RouterLink v-if="showCatalog" to="/question-papers" class="button secondary"
      ><BookOpen :size="16" />原卷题库</RouterLink
    >
  </div>
  <div v-if="showCatalog" class="mb">
    <AsyncState :loading="catalogLoading" :error="catalogError" @retry="loadCatalog">
      <PracticeCatalog
        :categories="catalog"
        :selected-id="scope.categoryId"
        :includes-descendants="scope.includeDescendants"
        @select="selectCategory"
      />
    </AsyncState>
  </div>
  <div v-if="showCatalog" id="practice-results">
    <p v-if="scope.paperId" class="actions mb practice-scope">
      <RouterLink :to="`/question-papers/${scope.paperId}`" class="text-link">当前原卷目录</RouterLink>
      <button
        class="button secondary small"
        type="button"
        @click="navigate({ ...draft, paperId: '', page: 1 })"
      >
        清除原卷
      </button>
    </p>
    <p v-if="scope.categoryId" class="actions mb practice-scope">
      <span>{{ selectedScopeLabel }}</span>
      <button class="button secondary small" type="button" @click="selectCategory('', false)">
        清除章节
      </button>
    </p>
    <div class="tabs" aria-label="练习模式" role="group">
      <button
        v-for="item in practiceModes"
        :key="item.value"
        class="tab"
        :class="{ active: scope.mode === item.value }"
        :aria-pressed="scope.mode === item.value"
        @click="selectMode(item.value)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
  <form
    :id="showCatalog ? undefined : 'practice-results'"
    class="toolbar"
    @submit.prevent="navigate({ ...draft, page: 1 })"
  >
    <label v-if="!wrong" class="search-field">
      题目关键词<input v-model="draft.q" placeholder="搜索题干中的关键词" maxlength="100" />
    </label>
    <label v-if="!showCatalog">
      章节 / 科目<select v-model="draft.categoryId" @change="draft.includeDescendants = false">
        <option value="">全部章节</option>
        <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.subject }} · {{ c.name }}</option>
      </select>
    </label>
    <label v-if="scope.mode === 'past' || scope.year">
      考试年份<input v-model="draft.year" type="number" min="1990" max="2100" placeholder="全部年份" />
    </label>
    <template v-if="wrong">
      <label>
        掌握状态<select v-model="draft.mastered">
          <option value="false">待复盘</option>
          <option value="true">已掌握</option>
        </select>
      </label>
      <label>
        排序<select v-model="draft.sort">
          <option value="count">错误次数最多</option>
          <option value="recent">最近更新</option>
        </select>
      </label>
      <label>更新时间起<input v-model="draft.since" type="date" /></label>
    </template>
    <button class="button" :disabled="loading">筛选题目</button>
  </form>
  <p v-if="!showCatalog && catalogError" class="form-error" role="alert">
    章节加载失败。<button type="button" class="text-link" @click="loadCatalog">重新加载章节</button>
  </p>
  <AsyncState
    :loading="loading"
    :error="error"
    :empty="!rows.length"
    :empty-text="
      scope.mode === 'past'
        ? '当前范围没有真题'
        : wrong
          ? '当前范围没有错题'
          : favorite
            ? '当前范围没有收藏题目'
            : '没有找到符合条件的题目'
    "
    @retry="load"
  >
    <div class="panel-heading">
      <span class="muted" style="font-size: 12px">共 {{ total }} 道题目</span
      ><span class="section-note">客观题提交后显示解析，主观题支持阅读与自评</span>
    </div>
    <article v-for="(item, i) in rows" :key="item.id" class="list-card">
      <div class="list-card-head">
        <div>
          <div class="meta-row" style="margin-top: 0">
            <DataBadge :status="item.status" /><span>{{ item.subject }}</span
            ><span>{{ questionTypeLabels[item.type] }}</span>
          </div>
          <h2>{{ (scope.page - 1) * practicePageSize + i + 1 }}. {{ questionPreview(item.title) }}</h2>
        </div>
      </div>
      <div class="card-bottom">
        <div class="meta-row" style="margin: 0">
          <span>{{ item.sourceLabel }}</span
          ><span v-if="wrong">累计错误 {{ item.wrongCount }} 次</span
          ><span v-else>难度 {{ item.difficulty }} / 5</span>
        </div>
        <div class="actions">
          <button
            v-if="wrong"
            class="button secondary small"
            :disabled="pendingMastery.has(item.id)"
            @click="mark(item.id)"
          >
            {{ scope.mastered === 'true' ? '恢复复盘' : '标记已掌握' }}
          </button>
          <RouterLink :to="practiceQuestionLocation(scope, item.id)" class="button small">
            {{ wrong ? '再练一次' : '开始练习' }}<ArrowRight :size="14" />
          </RouterLink>
        </div>
      </div>
    </article>
    <div class="pagination">
      <button
        class="button secondary small"
        :disabled="scope.page === 1"
        @click="navigate({ ...scope, page: scope.page - 1 })"
      >
        上一页
      </button>
      <span>{{ scope.page }} / {{ lastPage }}</span>
      <button
        class="button secondary small"
        :disabled="scope.page >= lastPage"
        @click="navigate({ ...scope, page: scope.page + 1 })"
      >
        下一页
      </button>
    </div>
  </AsyncState>
</template>

<style scoped>
.practice-scope {
  overflow-wrap: anywhere;
}
</style>
