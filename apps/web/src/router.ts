import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from './stores/auth';
export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/',
      component: () => import('./pages/Dashboard.vue'),
      meta: { title: '学习工作台', auth: true },
    },
    { path: '/login', component: () => import('./pages/Auth.vue'), meta: { title: '登录知岸' } },
    { path: '/register', component: () => import('./pages/Auth.vue'), meta: { title: '创建账户' } },
    {
      path: '/practice',
      component: () => import('./pages/Practice.vue'),
      meta: { title: '刷题中心', auth: true },
    },
    {
      path: '/practice/:id',
      component: () => import('./pages/Question.vue'),
      meta: { title: '专注练习', auth: true },
    },
    {
      path: '/wrong',
      component: () => import('./pages/Practice.vue'),
      meta: { title: '错题复盘', auth: true },
    },
    {
      path: '/favorites',
      component: () => import('./pages/Practice.vue'),
      meta: { title: '题目收藏', auth: true },
    },
    { path: '/exams', component: () => import('./pages/Exams.vue'), meta: { title: '模拟考场', auth: true } },
    {
      path: '/exams/:id',
      component: () => import('./pages/Exam.vue'),
      meta: { title: '模拟考试', auth: true },
    },
    {
      path: '/exams/:id/result',
      component: () => import('./pages/Exam.vue'),
      meta: { title: '考试报告', auth: true },
    },
    {
      path: '/statistics',
      component: () => import('./pages/Statistics.vue'),
      meta: { title: '学习数据', auth: true },
    },
    { path: '/jobs', component: () => import('./pages/Jobs.vue'), meta: { title: '发现岗位' } },
    {
      path: '/jobs/favorites',
      component: () => import('./pages/Jobs.vue'),
      meta: { title: '岗位收藏', auth: true },
    },
    {
      path: '/jobs/compare',
      component: () => import('./pages/JobCompare.vue'),
      meta: { title: '岗位对比', auth: true },
    },
    { path: '/jobs/:id', component: () => import('./pages/JobDetail.vue'), meta: { title: '岗位详情' } },
    {
      path: '/announcements',
      component: () => import('./pages/Announcements.vue'),
      meta: { title: '招考资讯' },
    },
    {
      path: '/announcements/:id',
      component: () => import('./pages/Announcement.vue'),
      meta: { title: '公告详情' },
    },
    {
      path: '/profile',
      component: () => import('./pages/Profile.vue'),
      meta: { title: '个人中心', auth: true },
    },
    {
      path: '/admin/:section?',
      component: () => import('./pages/Admin.vue'),
      meta: { title: '内容管理', auth: true, admin: true },
    },
    {
      path: '/:pathMatch(.*)*',
      component: () => import('./pages/NotFound.vue'),
      meta: { title: '页面不存在' },
    },
  ],
});
router.beforeEach(async (to) => {
  const auth = useAuth();
  if (!auth.initialized) {
    try {
      await auth.load();
    } catch {
      /* pages display API failures */
    }
  }
  if (to.meta.auth && !auth.user) return { path: '/login', query: { redirect: to.fullPath } };
  if (to.meta.admin && auth.user?.role !== 'admin') return '/';
  document.title = `${to.meta.title ?? '学习'} · 知岸公考`;
});
