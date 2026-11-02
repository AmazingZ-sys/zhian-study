<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  LayoutDashboard,
  BookOpen,
  Bookmark,
  ChartNoAxesCombined,
  BriefcaseBusiness,
  Newspaper,
  GraduationCap,
  Layers,
  Settings2,
  ArrowUpRight,
  LogOut,
  Menu,
  ShieldCheck,
  Compass,
} from 'lucide-vue-next';
import { ElMessage } from 'element-plus';
import { useAuth } from './stores/auth';
import { errorText } from './api';
const route = useRoute(),
  router = useRouter(),
  auth = useAuth(),
  menu = ref(false);
const learning = [
  { to: '/', label: '学习工作台', icon: LayoutDashboard },
  { to: '/practice', label: '刷题中心', icon: BookOpen },
  { to: '/wrong', label: '错题复盘', icon: Layers },
  { to: '/favorites', label: '我的题目', icon: Bookmark },
  { to: '/exams', label: '模拟考场', icon: GraduationCap },
  { to: '/statistics', label: '学习数据', icon: ChartNoAxesCombined },
];
const discovery = [
  { to: '/jobs', label: '发现岗位', icon: BriefcaseBusiness },
  { to: '/jobs/favorites', label: '岗位收藏', icon: Bookmark },
  { to: '/announcements', label: '招考资讯', icon: Newspaper },
];
async function logout() {
  try {
    await auth.logout();
    await router.push('/login');
  } catch (e) {
    ElMessage.error(errorText(e));
  }
}
</script>
<template>
  <a class="skip-link" href="#main">跳转到主要内容</a>
  <div class="app-shell">
    <aside class="sidebar" :class="{ open: menu }">
      <RouterLink to="/" class="brand" @click="menu = false"
        ><span class="brand-mark"><Compass :size="26" /></span
        ><span>知岸<span class="brand-sub">ZHIAN STUDY</span></span></RouterLink
      >
      <div class="sidebar-note">有方向，也有自己的节奏。</div>
      <nav aria-label="主导航">
        <p class="nav-caption">我的学习 <span>STUDY</span></p>
        <RouterLink
          v-for="item in learning"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          :class="{ selected: route.path === item.to }"
          @click="menu = false"
          ><component :is="item.icon" :size="19" /><span>{{ item.label }}</span
          ><span v-if="route.path === item.to" class="nav-dot"></span
        ></RouterLink>
        <p class="nav-caption discovery-caption">探索机会 <span>EXPLORE</span></p>
        <RouterLink
          v-for="item in discovery"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          :class="{ selected: route.path === item.to }"
          @click="menu = false"
          ><component :is="item.icon" :size="19" /><span>{{ item.label }}</span></RouterLink
        >
        <RouterLink v-if="auth.user?.role === 'admin'" to="/admin" class="nav-link" @click="menu = false"
          ><ShieldCheck :size="19" />管理后台</RouterLink
        >
      </nav>
      <div class="sidebar-bottom">
        <div class="quiet-card">
          <span class="tiny-label">给正在努力的你</span>
          <p>向前一点，<br />离岸就近一点。</p>
          <ArrowUpRight :size="22" />
        </div>
        <RouterLink class="nav-link" to="/profile"><Settings2 :size="19" />个人中心</RouterLink>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div class="crumb">
          <button
            class="icon-button mobile-menu"
            aria-label="打开导航"
            :aria-expanded="menu"
            @click="menu = !menu"
          >
            <Menu :size="22" />
</button
          ><span>知岸公考</span><span class="slash">/</span><strong>{{ route.meta.title }}</strong>
        </div>
        <div class="topbar-right">
          <span class="status-dot"></span><span class="desktop-only">循序而行，日有所进</span
          ><RouterLink v-if="auth.user" to="/profile" class="user-chip"
            ><img
              v-if="auth.user.avatarUrl"
              class="avatar"
              :src="auth.user.avatarUrl"
              alt="我的头像"
              referrerpolicy="no-referrer"
            /><span v-else class="avatar">{{ auth.user.name.slice(0, 1) }}</span
            ><span>{{ auth.user.name }}</span></RouterLink
          ><RouterLink v-else to="/login" class="button small">登录 / 注册</RouterLink
          ><button v-if="auth.user" class="icon-button" aria-label="退出登录" @click="logout">
            <LogOut :size="17" />
          </button>
        </div>
      </header>
      <main id="main" tabindex="-1"><RouterView :key="route.path" /></main>
      <footer class="footer">
        <span>知岸公考 · 认真学习，从容选择</span><span>招录信息与资格认定请以官方公告为准</span>
      </footer>
    </div>
  </div>
</template>
