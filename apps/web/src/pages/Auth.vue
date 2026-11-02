<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRight } from 'lucide-vue-next';
import { authSchema } from '@zhian/contracts';
import { useAuth } from '../stores/auth';
import { errorText } from '../api';
const route = useRoute(),
  router = useRouter(),
  auth = useAuth(),
  register = computed(() => route.path === '/register'),
  email = ref(''),
  password = ref(''),
  name = ref(''),
  error = ref(''),
  busy = ref(false);
async function submit() {
  error.value = '';
  const result = authSchema.safeParse({
    email: email.value,
    password: password.value,
    ...(register.value ? { name: name.value } : {}),
  });
  if (!result.success) {
    error.value = result.error.issues.map((i) => i.message).join('；');
    return;
  }
  busy.value = true;
  try {
    await auth.login(result.data, register.value);
    const redirect = String(route.query.redirect ?? '/');
    await router.push(redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="auth-layout">
    <section class="auth-intro">
      <div class="eyebrow">A LITTLE PROGRESS, EVERY DAY</div>
      <h1>心中有方向，<br />脚下有力量。</h1>
      <p>把知识一点点积累，把选择看得更清楚。<br />知岸，陪你走好备考的每一步。</p>
      <div class="meta-row mt"><span>专注练习</span><span>科学复盘</span><span>从容选岗</span></div>
    </section>
    <section class="auth-form">
      <h2>{{ register ? '开启你的知岸之旅' : '欢迎回到知岸' }}</h2>
      <p class="muted">{{ register ? '创建账户，记录每一次真实进步。' : '接着上一次的积累，继续向前。' }}</p>
      <form @submit.prevent="submit">
        <label v-if="register"
          >昵称<input v-model="name" name="name" autocomplete="nickname" maxlength="40" required /></label
        ><label
          >邮箱<input
            v-model="email"
            type="email"
            name="email"
            autocomplete="email"
            required
            maxlength="254" /></label
        ><label
          >密码<input
            v-model="password"
            aria-label="密码"
            aria-describedby="password-guidance"
            type="password"
            name="password"
            :autocomplete="register ? 'new-password' : 'current-password'"
            minlength="10"
            maxlength="128"
            required
          /><small v-if="register" id="password-guidance">至少 10 位，请使用独立密码。</small></label
        >
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="button" :disabled="busy" type="submit">
          {{ busy ? '正在处理…' : register ? '创建账户' : '登录知岸' }}<ArrowRight :size="16" />
        </button>
      </form>
      <p class="muted mt">
        {{ register ? '已经有账户？' : '还没有账户？' }}
        <RouterLink class="text-link" :to="register ? '/login' : '/register'">{{
          register ? '返回登录' : '免费注册'
        }}</RouterLink>
      </p>
    </section>
  </div>
</template>
