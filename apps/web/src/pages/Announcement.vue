<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowLeft, ExternalLink, Bookmark } from 'lucide-vue-next';
import type { Announcement } from '@zhian/contracts';
import { api, errorText } from '../api';
import { useAuth } from '../stores/auth';
import AsyncState from '../components/AsyncState.vue';
import DataBadge from '../components/DataBadge.vue';
import RichText from '../components/RichText.vue';
const route = useRoute(),
  router = useRouter(),
  auth = useAuth(),
  item = ref<Announcement>(),
  loading = ref(true),
  error = ref('');
async function load() {
  loading.value = true;
  error.value = '';
  try {
    item.value = (await api.get('/announcements/' + route.params.id)).data.data;
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
      url: '/announcements/' + item.value!.id + '/favorite',
      method: item.value!.favorite ? 'DELETE' : 'POST',
    });
    item.value!.favorite = !item.value!.favorite;
  } catch (e) {
    ElMessage.error(errorText(e));
  }
}
onMounted(load);
</script>
<template>
  <RouterLink class="text-link mb" to="/announcements"><ArrowLeft :size="15" />返回资讯列表</RouterLink
  ><AsyncState :loading="loading" :error="error" @retry="load">
    <article v-if="item" class="panel" style="max-width: 900px">
      <div class="meta-row">
        <DataBadge :status="item.status" /><span>{{ item.type }}</span
        ><span>{{ item.province }}</span>
      </div>
      <h1 style="margin: 20px 0">{{ item.title }}</h1>
      <div class="meta-row">
        <span>{{ item.sourceLabel }}</span
        ><span>{{ new Date(item.publishedAt).toLocaleString('zh-CN') }}</span>
      </div>
      <p v-if="item.status === 'demo'" class="notice mt">这是演示内容，不是真实招录公告。</p>
      <RichText class="prose" style="margin: 32px 0; font-size: 16px" :text="item.body" />
      <section v-if="item.attachments.length" class="mb">
        <h2 class="mb">附件</h2>
        <a
          v-for="a in item.attachments"
          :key="a.url"
          :href="a.url"
          target="_blank"
          rel="noopener noreferrer"
          class="text-link"
          style="display: flex; margin: 12px 0"
          >{{ a.name }}<ExternalLink :size="14"
        /></a>
      </section>
      <div class="actions">
        <a :href="item.sourceUrl" target="_blank" rel="noopener noreferrer" class="button"
          >查看原始来源<ExternalLink :size="15" /></a
        ><button class="button secondary" @click="favorite">
          <Bookmark :size="15" />{{ item.favorite ? '已收藏' : '收藏公告' }}
        </button>
      </div>
    </article>
  </AsyncState>
</template>
