<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ArrowUpRight } from 'lucide-vue-next';
import type { Announcement, PageMeta } from '@zhian/contracts';
import { api, errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
import DataBadge from '../components/DataBadge.vue';
const rows = ref<Announcement[]>([]),
  loading = ref(true),
  error = ref(''),
  q = ref(''),
  province = ref(''),
  type = ref(''),
  examType = ref(''),
  favorite = ref(false),
  page = ref(1),
  meta = ref<PageMeta>({ page: 1, pageSize: 10, total: 0 });
const types = [
  '国考公告',
  '省考公告',
  '事业单位公告',
  '报名通知',
  '资格审查',
  '准考证打印',
  '笔试通知',
  '成绩查询',
  '面试公告',
  '体检与录用公告',
];
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await api.get('/announcements', {
      params: {
        q: q.value || undefined,
        province: province.value || undefined,
        type: type.value || undefined,
        examType: examType.value || undefined,
        favorite: favorite.value ? 'true' : undefined,
        page: page.value,
        pageSize: 10,
      },
    });
    rows.value = data.data;
    meta.value = data.meta;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
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
      <div class="eyebrow">STAY INFORMED, STAY PREPARED</div>
      <h1>重要的消息，不必错过。</h1>
      <p>集中查看招考节点，保留每条信息的原始出处。</p>
    </div>
  </div>
  <form class="toolbar" @submit.prevent="search">
    <label class="search-field"
      >搜索公告<input v-model="q" placeholder="搜索公告标题" maxlength="100" /></label
    ><label>地区<input v-model="province" placeholder="全部地区" /></label
    ><label>考试类型<input v-model="examType" placeholder="国考 / 省考" /></label
    ><label
      >公告类型<select v-model="type">
        <option value="">全部公告</option>
        <option v-for="v in types" :key="v">{{ v }}</option>
      </select></label
    ><button class="button" :disabled="loading">查找公告</button>
  </form>
  <div class="tabs">
    <button
      class="tab"
      :class="{ active: !favorite }"
      @click="
        favorite = false;
        search();
      "
    >
      全部资讯
</button
    ><button
      class="tab"
      :class="{ active: favorite }"
      @click="
        favorite = true;
        search();
      "
    >
      我的收藏
    </button>
  </div>
  <AsyncState
    :loading="loading"
    :error="error"
    :empty="!rows.length"
    empty-text="暂无符合条件的公告"
    @retry="load"
  >
    <article v-for="a in rows" :key="a.id" class="list-card">
      <div class="meta-row" style="margin-top: 0">
        <DataBadge :status="a.status" /><span>{{ a.type }}</span
        ><span>{{ a.province }}</span>
      </div>
      <RouterLink :to="'/announcements/' + a.id"
        ><h2>{{ a.title }}</h2></RouterLink
      >
      <p class="muted" style="margin-top: 12px; font-size: 13px">
        {{ a.body.slice(0, 100) }}{{ a.body.length > 100 ? '…' : '' }}
      </p>
      <div class="card-bottom">
        <span class="muted" style="font-size: 12px"
          >{{ a.sourceLabel }} · {{ new Date(a.publishedAt).toLocaleDateString('zh-CN') }}</span
        ><RouterLink class="text-link" :to="'/announcements/' + a.id"
          >阅读全文 <ArrowUpRight :size="16"
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
