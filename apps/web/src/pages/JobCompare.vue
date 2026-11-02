<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import type { Job, MatchResult } from '@zhian/contracts';
import { api, errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
import DataBadge from '../components/DataBadge.vue';
const route = useRoute(),
  rows = ref<Job[]>([]),
  matches = ref<(MatchResult & { jobId: string })[]>([]),
  loading = ref(true),
  error = ref('');
const fields: { label: string; value: (j: Job) => string | number }[] = [
  { label: '招录单位', value: (j) => j.organization },
  { label: '地区', value: (j) => j.province + ' · ' + j.city },
  { label: '招录人数', value: (j) => j.headcount },
  { label: '学历 / 学位', value: (j) => j.education + ' / ' + j.degree },
  { label: '专业要求', value: (j) => j.majorText },
  { label: '年龄', value: (j) => j.minAge + '–' + j.maxAge + ' 岁' },
  { label: '工作经历', value: (j) => j.workYears + ' 年' },
  { label: '政治面貌', value: (j) => j.politicalStatus },
  { label: '其他资格条件', value: (j) => j.otherRequirements || '未单列，请核对原文' },
  {
    label: '报名截止',
    value: (j) => (j.registrationEnd ? new Date(j.registrationEnd).toLocaleString('zh-CN') : '未公布'),
  },
];
async function load() {
  loading.value = true;
  error.value = '';
  try {
    if (!route.query.ids) throw new Error('请先在岗位库选择 2–4 个岗位');
    rows.value = (await api.get('/jobs', { params: { ids: route.query.ids } })).data.data;
    matches.value = (await api.post('/jobs/match', { jobIds: rows.value.map((j) => j.id) })).data.data;
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
      <div class="eyebrow">MAKE AN INFORMED CHOICE</div>
      <h1>把选择，放在一起看。</h1>
      <p>并排核对条件，找到更适合自己的机会。</p>
    </div>
    <RouterLink class="button secondary" to="/jobs">返回岗位库</RouterLink>
  </div>
  <AsyncState :loading="loading" :error="error" @retry="load">
    <section class="panel table-wrap">
      <table class="compare-table">
        <thead>
          <tr>
            <th>对比项目</th>
            <th v-for="job in rows" :key="job.id">
              <DataBadge :status="job.status" /><RouterLink
                :to="'/jobs/' + job.id"
                style="display: block; margin-top: 12px"
                >{{ job.title }}</RouterLink
              >
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in fields" :key="f.label">
            <th>{{ f.label }}</th>
            <td v-for="job in rows" :key="job.id">{{ f.value(job) }}</td>
          </tr>
          <tr>
            <th>我的条件匹配</th>
            <td v-for="job in rows" :key="job.id">
              <strong>{{ matches.find((m) => m.jobId === job.id)?.status }}</strong>
              <p
                v-for="r in matches
                  .find((m) => m.jobId === job.id)
                  ?.reasons.filter((r) => r.status !== '符合')"
                :key="r.field"
                class="muted"
                style="font-size: 12px; margin-top: 10px"
              >
                {{ r.field }}：{{ r.message }}
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <p class="notice mt">匹配仅作辅助筛选，不等同于官方资格审查。请逐项核对原始公告及专业目录。</p>
  </AsyncState>
</template>
