<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { profileSchema, type Profile, type Job } from '@zhian/contracts';
import { useAuth } from '../stores/auth';
import { api, errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
const auth = useAuth(),
  router = useRouter(),
  profile = ref<Profile>(profileSchema.parse({})),
  loading = ref(true),
  error = ref(''),
  busy = ref(false),
  currentPassword = ref(''),
  newPassword = ref(''),
  planTitle = ref(''),
  target = ref(100),
  dueDate = ref('');
type Plan = { id: string; title: string; target: number; dueDate: string; completed: boolean };
type Session = { id: string; device: string; createdAt: string; revokedAt: string | null };
type Reminder = { id: string; dueAt: string; read: boolean; job: Job };
const plans = ref<Plan[]>([]),
  sessions = ref<Session[]>([]),
  reminders = ref<Reminder[]>([]);
async function load() {
  loading.value = true;
  error.value = '';
  try {
    await auth.load();
    profile.value = { ...auth.profile!, name: auth.user!.name, avatarUrl: auth.user!.avatarUrl ?? '' };
    const [a, b, c] = await Promise.all([
      api.get('/study-plans'),
      api.get('/users/me/sessions'),
      api.get('/reminders'),
    ]);
    plans.value = a.data.data;
    sessions.value = b.data.data;
    reminders.value = c.data.data;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
async function save() {
  const parsed = profileSchema.safeParse(profile.value);
  if (!parsed.success) {
    ElMessage.error(parsed.error.issues[0]?.message ?? '资料不完整');
    return;
  }
  busy.value = true;
  try {
    await api.patch('/users/me', parsed.data);
    await auth.load();
    ElMessage.success('个人资料已保存');
  } catch (e) {
    ElMessage.error(errorText(e));
  } finally {
    busy.value = false;
  }
}
async function password() {
  busy.value = true;
  try {
    await api.patch('/users/me/password', {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    });
    auth.user = null;
    ElMessage.success('密码已修改，所有设备已退出，请重新登录');
    await router.push('/login');
  } catch (e) {
    ElMessage.error(errorText(e));
  } finally {
    busy.value = false;
  }
}
async function revoke(id: string) {
  try {
    await ElMessageBox.confirm('确定撤销这个登录会话？当前设备可能需要重新登录。', '撤销会话');
    await api.delete('/users/me/sessions/' + id);
    await load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errorText(e));
  }
}
async function createPlan() {
  try {
    await api.post('/study-plans', { title: planTitle.value, target: target.value, dueDate: dueDate.value });
    planTitle.value = '';
    await load();
  } catch (e) {
    ElMessage.error(errorText(e));
  }
}
async function togglePlan(plan: Plan) {
  try {
    await api.patch('/study-plans/' + plan.id, { completed: !plan.completed });
    plan.completed = !plan.completed;
  } catch (e) {
    ElMessage.error(errorText(e));
  }
}
async function deletePlan(id: string) {
  try {
    await ElMessageBox.confirm('删除此学习计划？', '确认删除');
    await api.delete('/study-plans/' + id);
    plans.value = plans.value.filter((p) => p.id !== id);
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errorText(e));
  }
}
async function readReminder(r: Reminder) {
  try {
    await api.patch('/reminders/' + r.id);
    r.read = true;
  } catch (e) {
    ElMessage.error(errorText(e));
  }
}
onMounted(load);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">YOUR GOALS, YOUR PACE</div>
      <h1>为自己的目标，做好准备。</h1>
      <p>资料仅用于个人学习目标和岗位辅助匹配。</p>
    </div>
  </div>
  <AsyncState :loading="loading" :error="error" @retry="load">
    <div class="detail-grid">
      <div class="stack">
        <form class="panel" @submit.prevent="save">
          <section class="form-section">
            <h2>基本资料与学习目标</h2>
            <div class="form-grid">
              <label>昵称<input v-model="profile.name" required maxlength="40" /></label
              ><label
                >头像 URL<input v-model="profile.avatarUrl" type="url" placeholder="https://…" /><small
                  >仅支持 HTTP(S) 图片地址，不上传本地文件。</small
                ></label
              ><label
                >目标考试<select v-model="profile.examType">
                  <option>国考</option>
                  <option>省考</option>
                  <option>事业单位</option>
                  <option>其他</option>
                </select></label
              ><label
                >考试年份<input
                  v-model.number="profile.targetYear"
                  type="number"
                  min="2020"
                  max="2100"
                  required /></label
              ><label>目标省份<input v-model="profile.province" maxlength="40" /></label
              ><label>目标城市<input v-model="profile.city" maxlength="40" /></label
              ><label
                >每日学习目标（题）<input
                  v-model.number="profile.dailyGoal"
                  type="number"
                  min="1"
                  max="500"
                  required
              /></label>
            </div>
          </section>
          <section class="form-section">
            <h2>报考条件</h2>
            <div class="form-grid">
              <label
                >学历<select v-model="profile.education">
                  <option v-for="v in ['不限', '高中', '大专', '本科', '硕士', '博士']" :key="v">
                    {{ v }}
                  </option>
                </select></label
              ><label>学位<input v-model="profile.degree" placeholder="例如：学士" maxlength="40" /></label
              ><label
                >专业<input
                  v-model="profile.major"
                  placeholder="毕业证上的完整专业名称"
                  maxlength="100"
                /><small>使用专业目录精确匹配，简称可能需要人工确认。</small></label
              ><label
                >政治面貌<input
                  v-model="profile.politicalStatus"
                  placeholder="例如：群众 / 中共党员"
                  maxlength="40" /></label
              ><label
                >基层工作经历（年）<input
                  v-model.number="profile.workYears"
                  type="number"
                  min="0"
                  max="60"
                  step="0.5" /></label
              ><label
                >年龄（周岁）<input
                  :value="profile.age"
                  type="number"
                  min="16"
                  max="80"
                  @input="
                    profile.age = ($event.target as HTMLInputElement).value
                      ? Number(($event.target as HTMLInputElement).value)
                      : null
                  "
              /></label>
            </div>
          </section>
          <button class="button" :disabled="busy">{{ busy ? '正在保存…' : '保存个人资料' }}</button>
        </form>
        <section class="panel">
          <h2 class="mb">学习计划</h2>
          <form class="form-grid mb" @submit.prevent="createPlan">
            <label
              >计划名称<input
                v-model="planTitle"
                required
                maxlength="100"
                placeholder="例如：完成数量关系专项" /></label
            ><label
              >目标题数<input v-model.number="target" type="number" min="1" max="100000" required /></label
            ><label>目标日期<input v-model="dueDate" type="date" required /></label>
            <div class="actions"><button class="button secondary">添加计划</button></div>
          </form>
          <p v-if="!plans.length" class="muted">还没有计划，可以从一个小目标开始。</p>
          <div v-for="p in plans" :key="p.id" class="mini-item">
            <h3>{{ p.title }} <span v-if="p.completed" class="badge verified">已完成</span></h3>
            <p class="muted">{{ p.target }} 题 · {{ p.dueDate }} 前</p>
            <div class="actions mt">
              <button class="button secondary small" @click="togglePlan(p)">
                {{ p.completed ? '重新开启' : '标记完成' }}
</button
              ><button class="button ghost small" @click="deletePlan(p.id)">删除</button>
            </div>
          </div>
        </section>
        <section class="panel">
          <h2 class="mb">修改密码</h2>
          <form class="form-grid" @submit.prevent="password">
            <label
              >原密码<input
                v-model="currentPassword"
                type="password"
                autocomplete="current-password"
                minlength="10"
                maxlength="128"
                required /></label
            ><label
              >新密码<input
                v-model="newPassword"
                type="password"
                autocomplete="new-password"
                minlength="10"
                maxlength="128"
                required
            /></label>
            <div class="wide">
              <p class="muted mb">修改后会撤销所有设备的登录会话。</p>
              <button class="button secondary" :disabled="busy">修改密码并重新登录</button>
            </div>
          </form>
        </section>
      </div>
      <aside class="stack">
        <section class="panel">
          <h2 class="mb">报名时间提醒</h2>
          <p class="muted" style="font-size: 12px">
            收藏岗位后建立截止前一天的站内提醒。这里只在站内展示，不发送外部通知。
          </p>
          <p v-if="!reminders.length" class="muted mt">暂无提醒</p>
          <div v-for="r in reminders" :key="r.id" class="mini-item mt">
            <RouterLink :to="'/jobs/' + r.job.id"
              ><h3>{{ r.job.title }}</h3></RouterLink
            >
            <p>{{ new Date(r.dueAt).toLocaleString('zh-CN') }}</p>
            <p v-if="r.job.status === 'demo'" class="badge demo">演示岗位</p>
            <button v-if="!r.read" class="button ghost small" @click="readReminder(r)">标记已读</button
            ><span v-else class="muted">已读</span>
          </div>
        </section>
        <section class="panel">
          <h2 class="mb">登录会话</h2>
          <div v-for="s in sessions" :key="s.id" class="mini-item">
            <h3>{{ s.device }}</h3>
            <p>{{ new Date(s.createdAt).toLocaleString('zh-CN') }}</p>
            <button v-if="!s.revokedAt" class="button ghost small" @click="revoke(s.id)">撤销此会话</button
            ><span v-else class="muted">已撤销</span>
          </div>
        </section>
      </aside>
    </div>
  </AsyncState>
</template>
