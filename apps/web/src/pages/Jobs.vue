<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowRight, MapPin, BriefcaseBusiness } from 'lucide-vue-next';
import type { Job, PageMeta } from '@zhian/contracts';
import { api, errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
import DataBadge from '../components/DataBadge.vue';
const route = useRoute(),
  favorite = computed(() => route.path === '/jobs/favorites'),
  rows = ref<Job[]>([]),
  loading = ref(true),
  error = ref(''),
  page = ref(1),
  meta = ref<PageMeta>({ total: 0, page: 1, pageSize: 10 }),
  selected = ref<string[]>([]),
  advanced = ref(false);
const filters = ref({
  q: '',
  province: '',
  city: '',
  year: '',
  examType: '',
  education: '',
  degree: '',
  major: '',
  politicalStatus: '',
  workYears: '',
  minHeadcount: '',
  organization: '',
  sort: 'newest',
});
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = Object.fromEntries(Object.entries(filters.value).filter(([, v]) => v !== ''));
    const { data } = await api.get(favorite.value ? '/jobs/favorites' : '/jobs', {
      params: { ...params, page: page.value, pageSize: 10 },
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
function compare(id: string) {
  if (selected.value.includes(id)) selected.value = selected.value.filter((v) => v !== id);
  else if (selected.value.length < 4) selected.value.push(id);
}
onMounted(load);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">FIND YOUR NEXT CHAPTER</div>
      <h1>{{ favorite ? '留意的机会，放在这里。' : '适合你的方向，值得认真寻找。' }}</h1>
      <p>从地区、专业与学历出发，找到值得进一步了解的岗位。</p>
    </div>
    <RouterLink to="/jobs/favorites" class="button secondary">我的岗位收藏</RouterLink>
  </div>
  <section v-if="!favorite" class="panel mb">
    <form @submit.prevent="search">
      <div class="toolbar" style="margin-bottom: 16px">
        <label class="search-field"
          >搜索岗位<input
            v-model="filters.q"
            placeholder="岗位名称、招录单位或职位代码"
            maxlength="100" /></label
        ><label>省份<input v-model="filters.province" placeholder="例如：浙江" maxlength="40" /></label
        ><label
          >学历要求<select v-model="filters.education">
            <option value="">全部学历</option>
            <option v-for="v in ['不限', '高中', '大专', '本科', '硕士', '博士']" :key="v">{{ v }}</option>
          </select></label
        ><button class="button" :disabled="loading">查找岗位</button>
      </div>
      <div v-if="advanced" class="form-grid mb">
        <label>考试类型<input v-model="filters.examType" placeholder="国考 / 省考 / 事业单位" /></label
        ><label>招录年份<input v-model="filters.year" type="number" min="2020" max="2100" /></label
        ><label>城市<input v-model="filters.city" /></label
        ><label>招录单位<input v-model="filters.organization" /></label
        ><label>学位<input v-model="filters.degree" /></label
        ><label
          >专业关键词<input v-model="filters.major" /><small
            >此处仅做检索；资格匹配在详情页按目录核对。</small
          ></label
        ><label>政治面貌<input v-model="filters.politicalStatus" /></label
        ><label>可满足的工作年限<input v-model="filters.workYears" type="number" min="0" max="60" /></label
        ><label>最低招录人数<input v-model="filters.minHeadcount" type="number" min="1" /></label
        ><label
          >排序<select v-model="filters.sort">
            <option value="newest">最新入库</option>
            <option value="headcount">招录人数最多</option>
            <option value="deadline">报名截止最早</option>
          </select></label
        >
      </div>
      <div class="actions">
        <button type="button" class="text-link button ghost small" @click="advanced = !advanced">
          {{ advanced ? '收起筛选' : '更多筛选条件' }}
</button
        ><span class="section-note">信息仅作辅助，请核对官方原文及报名截止时间。</span>
      </div>
    </form>
  </section>
  <AsyncState
    :loading="loading"
    :error="error"
    :empty="!rows.length"
    :empty-text="favorite ? '还没有收藏的岗位' : '暂无符合条件的岗位'"
    @retry="load"
  >
    <div class="panel-heading">
      <span class="muted">共 {{ meta.total }} 个岗位</span
      ><span class="section-note">可选择 2–4 个岗位进行对比</span>
    </div>
    <article v-for="job in rows" :key="job.id" class="list-card">
      <div class="list-card-head">
        <div>
          <div class="meta-row" style="margin: 0 0 10px">
            <DataBadge :status="job.status" /><span>{{ job.year }} {{ job.examType }}</span>
          </div>
          <RouterLink :to="'/jobs/' + job.id"
            ><h2>{{ job.title }}</h2></RouterLink
          >
          <div class="meta-row">
            <BriefcaseBusiness :size="14" />{{ job.organization }}<span>{{ job.department }}</span>
          </div>
        </div>
        <div class="stat-number" style="margin: 0; color: var(--primary)">
          {{ job.headcount }}<span>人</span>
        </div>
      </div>
      <div class="meta-row">
        <MapPin :size="14" />{{ job.province }} · {{ job.city }}<span>{{ job.education }}</span
        ><span>{{ job.degree }}</span
        ><span>{{ job.majorText }}</span>
      </div>
      <div class="card-bottom">
        <span class="muted" style="font-size: 11px">职位代码 {{ job.code }} · {{ job.sourceLabel }}</span>
        <div class="actions">
          <button
            class="button secondary small"
            :disabled="selected.length >= 4 && !selected.includes(job.id)"
            :aria-pressed="selected.includes(job.id)"
            @click="compare(job.id)"
          >
            {{ selected.includes(job.id) ? '已加入对比' : '加入对比' }}
</button
          ><RouterLink class="button small" :to="'/jobs/' + job.id"
            >查看详情<ArrowRight :size="14"
          /></RouterLink>
        </div>
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
      ><span>{{ page }} / {{ Math.max(1, Math.ceil(meta.total / 10)) }}</span
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
  <div v-if="selected.length" class="compare-bar">
    <span>已选择 {{ selected.length }} 个岗位 · 最多 4 个</span>
    <div class="actions">
      <button class="button secondary small" @click="selected = []">清空</button
      ><RouterLink
        v-if="selected.length >= 2"
        class="button small"
        :to="{ path: '/jobs/compare', query: { ids: selected.join(',') } }"
        >对比这些岗位 <ArrowRight :size="15"
      /></RouterLink>
    </div>
  </div>
</template>
