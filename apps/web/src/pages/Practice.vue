<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowRight, BookOpen } from 'lucide-vue-next';
import type { Question, Category, PageMeta } from '@zhian/contracts';
import { api, errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
import DataBadge from '../components/DataBadge.vue';
import { ElMessage } from 'element-plus';
const route = useRoute(),
  wrong = computed(() => route.path === '/wrong'),
  favorite = computed(() => route.path === '/favorites'),
  rows = ref<Question[]>([]),
  cats = ref<Category[]>([]),
  loading = ref(true),
  error = ref(''),
  q = ref(''),
  categoryId = ref(String(route.query.categoryId ?? '')),
  mode = ref('sequential'),
  year = ref(''),
  sort = ref('count'),
  since = ref(''),
  mastered = ref('false'),
  page = ref(1),
  meta = ref<PageMeta>({ page: 1, pageSize: 10, total: 0 });
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [a, b] = await Promise.all([
      api.get(wrong.value ? '/wrong-questions' : '/questions', {
        params: {
          page: page.value,
          pageSize: 10,
          q: q.value || undefined,
          categoryId: categoryId.value || undefined,
          mode: favorite.value ? 'favorite' : mode.value,
          year: year.value || undefined,
          sort: sort.value,
          mastered: mastered.value,
          since: since.value ? new Date(since.value).toISOString() : undefined,
        },
      }),
      api.get('/question-categories'),
    ]);
    rows.value = a.data.data;
    meta.value = a.data.meta;
    cats.value = b.data.data;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
async function mark(id: string) {
  try {
    await api.patch('/wrong-questions/' + id + '/mastered', { mastered: mastered.value !== 'true' });
    ElMessage.success('已更新掌握状态');
    await load();
  } catch (e) {
    ElMessage.error(errorText(e));
  }
}
function search() {
  page.value = 1;
  void load();
}
onMounted(load);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">PRACTICE MAKES PROGRESS</div>
      <h1>
        {{
          wrong
            ? '把错题，变成下一次的底气。'
            : favorite
              ? '值得再看一遍的好题。'
              : '从一题开始，向目标靠近。'
        }}
      </h1>
      <p>
        {{ wrong ? '不急于做更多，先把每一个盲点学明白。' : '按自己的节奏练习。每次提交都会被妥善保存。' }}
      </p>
    </div>
    <BookOpen :size="28" class="muted" />
  </div>
  <div v-if="!wrong && !favorite" class="tabs">
    <button
      v-for="item in [
        ['sequential', '顺序练习'],
        ['random', '随机练习'],
        ['chapter', '章节练习'],
        ['special', '专项练习'],
        ['past', '历年真题'],
      ]"
      :key="item[0]"
      class="tab"
      :class="{ active: mode === item[0] }"
      @click="
        mode = item[0]!;
        search();
      "
    >
      {{ item[1] }}
    </button>
  </div>
  <form class="toolbar" @submit.prevent="search">
    <label v-if="!wrong" class="search-field"
      >题目关键词<input v-model="q" placeholder="搜索题干中的关键词" maxlength="100" /></label
    ><label
      >章节 / 科目<select v-model="categoryId">
        <option value="">全部章节</option>
        <option v-for="c in cats" :key="c.id" :value="c.id">{{ c.subject }} · {{ c.name }}</option>
      </select></label
    ><label v-if="mode === 'past'"
      >考试年份<input v-model="year" type="number" min="1990" max="2100" placeholder="全部年份" /></label
    ><template v-if="wrong">
      <label
        >掌握状态<select v-model="mastered">
          <option value="false">待复盘</option>
          <option value="true">已掌握</option>
        </select></label
      ><label
        >排序<select v-model="sort">
          <option value="count">错误次数最多</option>
          <option value="recent">最近更新</option>
        </select></label
      ><label>更新时间起<input v-model="since" type="date" /></label>
</template
    ><button class="button" :disabled="loading">筛选题目</button>
  </form>
  <AsyncState
    :loading="loading"
    :error="error"
    :empty="!rows.length"
    :empty-text="
      mode === 'past'
        ? '暂无合法授权真题，等待管理员导入'
        : wrong
          ? '当前没有需要复盘的错题'
          : favorite
            ? '还没有收藏题目'
            : '没有找到符合条件的题目'
    "
    @retry="load"
  >
    <div class="panel-heading">
      <span class="muted" style="font-size: 12px">共 {{ meta.total }} 道题目</span
      ><span class="section-note">答案提交后显示解析</span>
    </div>
    <article v-for="(item, i) in rows" :key="item.id" class="list-card">
      <div class="list-card-head">
        <div>
          <div class="meta-row" style="margin-top: 0">
            <DataBadge :status="item.status" /><span>{{ item.subject }}</span
            ><span>{{ { single: '单选题', multiple: '多选题', boolean: '判断题' }[item.type] }}</span>
          </div>
          <h2>{{ (page - 1) * 10 + i + 1 }}. {{ item.title }}</h2>
        </div>
      </div>
      <div class="card-bottom">
        <div class="meta-row" style="margin: 0">
          <span>{{ item.sourceLabel }}</span
          ><span v-if="wrong">累计错误 {{ item.wrongCount }} 次</span
          ><span v-else>难度 {{ item.difficulty }} / 5</span>
        </div>
        <div class="actions">
          <button v-if="wrong" class="button secondary small" @click="mark(item.id)">
            {{ mastered === 'true' ? '恢复复盘' : '标记已掌握' }}
</button
          ><RouterLink
            :to="{
              path: '/practice/' + item.id,
              query: {
                mode: wrong ? 'wrong' : favorite ? 'favorite' : mode,
                categoryId: categoryId || undefined,
                year: year || undefined,
                q: q || undefined,
              },
            }"
            class="button small"
            >{{ wrong ? '再练一次' : '开始练习' }}<ArrowRight :size="14"
          /></RouterLink>
        </div>
      </div>
    </article>
    <div class="pagination">
      <button
        class="button secondary small"
        :disabled="page === 1"
        @click="
          page--;
          load();
        "
      >
        上一页
</button
      ><span>{{ page }} / {{ Math.max(1, Math.ceil(meta.total / 10)) }}</span
      ><button
        class="button secondary small"
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
