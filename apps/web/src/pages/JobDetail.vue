<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ExternalLink, Bookmark, ScanSearch } from 'lucide-vue-next';
import { ElMessage } from 'element-plus';
import type { Job, MatchResult } from '@zhian/contracts';
import { api, errorText } from '../api';
import { useAuth } from '../stores/auth';
import { formatDate } from '@zhian/utils';
import AsyncState from '../components/AsyncState.vue';
import DataBadge from '../components/DataBadge.vue';
const route = useRoute(),
  router = useRouter(),
  auth = useAuth(),
  job = ref<Job>(),
  history = ref<{ version: number; createdAt: string; data: Job }[]>([]),
  match = ref<MatchResult>(),
  loading = ref(true),
  error = ref(''),
  matching = ref(false);
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [a, b] = await Promise.all([
      api.get('/jobs/' + route.params.id),
      api.get('/jobs/' + route.params.id + '/history'),
    ]);
    job.value = a.data.data;
    history.value = b.data.data;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
async function favorite() {
  if (!auth.user) {
    await router.push({ path: '/login', query: { redirect: route.fullPath } });
    return;
  }
  try {
    await api.request({
      url: '/jobs/' + job.value!.id + '/favorite',
      method: job.value!.favorite ? 'DELETE' : 'POST',
    });
    job.value!.favorite = !job.value!.favorite;
    ElMessage.success(job.value!.favorite ? '已收藏，并建立站内截止提醒' : '已取消收藏');
  } catch (e) {
    ElMessage.error(errorText(e));
  }
}
async function matchingJob() {
  if (!auth.user) {
    await router.push({ path: '/login', query: { redirect: route.fullPath } });
    return;
  }
  matching.value = true;
  try {
    match.value = (await api.post('/jobs/match', { jobIds: [job.value!.id] })).data.data[0];
  } catch (e) {
    ElMessage.error(errorText(e));
  } finally {
    matching.value = false;
  }
}
onMounted(load);
</script>
<template>
  <RouterLink class="text-link mb" to="/jobs"><ArrowLeft :size="15" />返回岗位库</RouterLink
  ><AsyncState :loading="loading" :error="error" @retry="load">
    <template v-if="job">
      <div class="page-heading">
        <div>
          <div class="meta-row">
            <DataBadge :status="job.status" /><span>{{ job.year }} {{ job.examType }}</span
            ><span>{{ job.province }} · {{ job.city }}</span>
          </div>
          <h1>{{ job.title }}</h1>
          <p>{{ job.organization }} · {{ job.department || '职位代码 ' + job.code }}</p>
        </div>
        <button class="button secondary" @click="favorite">
          <Bookmark :size="16" />{{ job.favorite ? '已收藏' : '收藏岗位' }}
        </button>
      </div>
      <div v-if="job.status !== 'verified'" class="notice">
        {{
          job.status === 'demo'
            ? '这是虚构演示岗位，不是真实招录信息，请勿据此报名。'
            : '当前信息尚未作为正式已核验内容发布，请务必核对官方原文。'
        }}
      </div>
      <div class="detail-grid">
        <div class="stack">
          <section class="panel">
            <h2>岗位与报考条件</h2>
            <dl class="definition-grid">
              <div
                v-for="[name, value] in [
                  ['招录人数', job.headcount + ' 人'],
                  ['职位代码', job.code],
                  ['学历', job.education],
                  ['学位', job.degree],
                  ['专业要求', job.majorText],
                  ['专业类别', job.majorCategory || '未单独说明'],
                  ['政治面貌', job.politicalStatus],
                  ['基层工作经历', job.workYears + ' 年'],
                  ['年龄要求', job.minAge + '–' + job.maxAge + ' 周岁'],
                  ['工作地区', [job.province, job.city, job.district].filter(Boolean).join(' · ')],
                ]"
                :key="String(name)"
              >
                <dt>{{ name }}</dt>
                <dd>{{ value }}</dd>
              </div>
            </dl>
            <h3 class="mb">其他资格条件</h3>
            <p class="prose muted">
              {{ job.otherRequirements || '当前数据未单列其他条件，请以官方公告及附件为准。' }}
            </p>
          </section>
          <section class="panel">
            <div class="panel-heading">
              <h2>我的条件匹配</h2>
              <RouterLink to="/profile" class="text-link">完善报考资料</RouterLink>
            </div>
            <p class="muted mb">逐项核对学历、年龄与专业目录。信息不足时不会直接判定符合。</p>
            <button class="button" :disabled="matching" @click="matchingJob">
              <ScanSearch :size="16" />{{ matching ? '正在核对…' : '检查我的报考条件' }}
</button
            ><template v-if="match">
              <h3 class="mt">匹配结果：{{ match.status }}</h3>
              <div v-for="r in match.reasons" :key="r.field" class="match-line">
                <strong
                  >{{ r.field
                  }}<span
                    class="badge"
                    :class="r.status === '符合' ? 'verified' : r.status === '不符合' ? 'expired' : 'pending'"
                    >{{ r.status }}</span
                  ></strong
                >
                <p class="muted">{{ r.message }}</p>
              </div>
              <p class="notice mt">{{ match.disclaimer }}</p>
            </template>
          </section>
          <section class="panel">
            <h2 class="mb">数据变更记录</h2>
            <p class="muted">当前版本 v{{ job.version }} · 更新于 {{ formatDate(job.updatedAt) }}</p>
            <details v-for="h in history" :key="h.version" class="mini-item">
              <summary>历史版本 v{{ h.version }} · {{ formatDate(h.createdAt) }}</summary>
              <p class="muted">
                {{ h.data.title }} · 招 {{ h.data.headcount }} 人 · {{ h.data.education }} ·
                {{ h.data.majorText }}
              </p>
            </details>
            <p v-if="!history.length" class="muted mt">暂无历史变更。</p>
          </section>
        </div>
        <aside class="stack">
          <section class="panel">
            <h2 class="mb">重要时间</h2>
            <dl>
              <dt class="muted">报名开始</dt>
              <dd style="margin: 8px 0 22px">{{ formatDate(job.registrationStart) }}</dd>
              <dt class="muted">报名截止</dt>
              <dd style="margin: 8px 0 22px">{{ formatDate(job.registrationEnd) }}</dd>
              <dt class="muted">考试时间</dt>
              <dd style="margin: 8px 0">{{ formatDate(job.examAt) }}</dd>
            </dl>
            <p class="muted mt" style="font-size: 12px">
              收藏后可在个人中心查看站内提醒；尚不发送短信或微信消息。
            </p>
          </section>
          <section class="panel">
            <h2 class="mb">核对原始信息</h2>
            <p class="muted">{{ job.sourceLabel }}</p>
            <p class="muted mt" style="font-size: 12px">发布于 {{ formatDate(job.publishedAt) }}</p>
            <a
              :href="job.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="button secondary w-full mt"
              >查看原文 <ExternalLink :size="14"
            /></a>
          </section>
        </aside>
      </div>
    </template>
  </AsyncState>
</template>
