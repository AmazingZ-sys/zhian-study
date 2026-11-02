<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Download, Upload } from 'lucide-vue-next';
import { api, errorText } from '../api';
import AsyncState from '../components/AsyncState.vue';
import DataBadge from '../components/DataBadge.vue';
const route = useRoute(),
  section = computed(() => String(route.params.section ?? 'overview')),
  loading = ref(true),
  error = ref(''),
  rows = ref<Record<string, unknown>[]>([]),
  overview = ref<Record<string, number>>({}),
  page = ref(1),
  total = ref(0),
  editor = ref(false),
  editId = ref(''),
  text = ref(''),
  busy = ref(false),
  kind = ref('questions'),
  format = ref('json'),
  file = ref<File>(),
  importText = ref('[]'),
  result = ref<{
    id: string;
    status: string;
    imported: number;
    errors: { row: number; message: string }[];
  }>(),
  categories = ref<{ id: string; name: string }[]>([]),
  sources = ref<{ id: string; name: string }[]>([]);
const sections = [
  ['overview', '管理概览'],
  ['users', '用户'],
  ['questions', '题库'],
  ['categories', '分类'],
  ['jobs', '岗位'],
  ['announcements', '公告'],
  ['imports', '导入导出'],
  ['sources', '数据来源'],
  ['audit-logs', '审计日志'],
];
const editable = computed(() =>
  ['questions', 'categories', 'jobs', 'announcements', 'sources'].includes(section.value),
);
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [a, b, c] = await Promise.all([
      api.get('/admin/' + section.value, { params: { page: page.value, pageSize: 20 } }),
      api.get('/admin/categories'),
      api.get('/admin/sources'),
    ]);
    if (section.value === 'overview') overview.value = a.data.data;
    else rows.value = a.data.data;
    total.value = a.data.meta?.total ?? rows.value.length;
    categories.value = b.data.data;
    sources.value = c.data.data;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
function template() {
  const now = new Date().toISOString();
  const source = {
    sourceId: sources.value[0]?.id ?? null,
    sourceLabel: '请填写合法数据来源',
    status: 'pending',
  };
  if (section.value === 'questions' || (section.value === 'imports' && kind.value === 'questions'))
    return {
      title: '请填写题干',
      subject: '数量关系',
      categoryId: categories.value[0]?.id ?? '',
      type: 'single',
      options: [
        { key: 'A', text: '选项一' },
        { key: 'B', text: '选项二' },
      ],
      correctAnswer: ['A'],
      explanation: '请填写原创或授权解析',
      difficulty: 2,
      tags: [],
      ...source,
    };
  if (section.value === 'jobs' || (section.value === 'imports' && kind.value === 'jobs'))
    return {
      year: 2027,
      examType: '省考',
      province: '请填写',
      city: '',
      organization: '请填写招录单位',
      title: '请填写岗位名称',
      code: '请填写唯一职位代码',
      headcount: 1,
      education: '本科',
      degree: '学士',
      majorText: '不限',
      majorCodes: [],
      minAge: 18,
      maxAge: 35,
      sourceUrl: 'https://example.com/replace-with-official-source',
      publishedAt: now,
      ...source,
    };
  if (section.value === 'announcements' || section.value === 'imports')
    return {
      title: '请填写标题',
      body: '请填写合法正文（纯文本）',
      type: '报名通知',
      examType: '省考',
      province: '全国',
      sourceUrl: 'https://example.com/replace-with-official-source',
      publishedAt: now,
      attachments: [],
      ...source,
    };
  if (section.value === 'categories') return { name: '新分类', subject: '行测', parentId: null, sort: 0 };
  return {
    name: '数据来源名称',
    url: 'https://example.com',
    terms: '请记录使用授权与访问限制',
    verification: 'pending',
    version: '1',
    fetchedAt: null,
  };
}
function edit(row?: Record<string, unknown>) {
  editId.value = row ? String(row.id) : '';
  const data = row ? { ...row } : template();
  for (const k of ['id', 'createdAt', 'updatedAt', 'version', 'favorite', 'count'])
    if (k !== 'version' || section.value !== 'sources') delete (data as Record<string, unknown>)[k];
  text.value = JSON.stringify(data, null, 2);
  editor.value = true;
}
async function save() {
  busy.value = true;
  try {
    const input = JSON.parse(text.value);
    await api.request({
      url: '/admin/' + section.value + (editId.value ? '/' + editId.value : ''),
      method: editId.value ? 'PATCH' : 'POST',
      data: input,
    });
    editor.value = false;
    ElMessage.success('内容已保存，审计已记录');
    await load();
  } catch (e) {
    const details = (e as { details?: { path: string; message: string }[] }).details;
    ElMessage.error(details?.map((d) => `${d.path}：${d.message}`).join('；') ?? errorText(e));
  } finally {
    busy.value = false;
  }
}
async function remove(row: Record<string, unknown>) {
  try {
    await ElMessageBox.confirm(
      section.value === 'categories'
        ? '删除分类？已有引用时将阻止删除。'
        : '停用该内容？历史学习记录仍会保留。',
      '确认操作',
      { confirmButtonText: '确认', cancelButtonText: '取消' },
    );
    await api.delete('/admin/' + section.value + '/' + row.id);
    await load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errorText(e));
  }
}
async function changeUser(row: Record<string, unknown>, field: 'active' | 'role') {
  try {
    await ElMessageBox.confirm('修改用户权限/状态将撤销该用户现有会话。继续吗？', '用户管理');
    await api.patch('/admin/users/' + row.id, {
      [field]: field === 'active' ? !row.active : row.role === 'admin' ? 'user' : 'admin',
    });
    await load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errorText(e));
  }
}
async function runImport() {
  busy.value = true;
  result.value = undefined;
  try {
    let data: unknown;
    if (file.value) {
      const f = new FormData();
      f.append('kind', kind.value);
      f.append('file', file.value);
      data = f;
    } else data = { kind: kind.value, rows: JSON.parse(importText.value) };
    result.value = (await api.post('/admin/imports', data)).data.data;
    ElMessage.success('导入成功');
    await load();
  } catch (e) {
    result.value = (e as { payload?: { data: typeof result.value } }).payload?.data;
    if (!result.value) ElMessage.error(errorText(e));
  } finally {
    busy.value = false;
  }
}
async function download(path: string, filename: string) {
  try {
    const response = await api.get(path, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    ElMessage.error(errorText(e));
  }
}
onMounted(load);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">CONTENT & OPERATIONS</div>
      <h1>让每一条内容，都值得信任。</h1>
      <p>管理员操作由服务器验证权限并写入审计日志。</p>
    </div>
    <button v-if="editable" class="button" @click="edit()"><Plus :size="16" />新增内容</button>
  </div>
  <nav class="admin-nav" aria-label="后台导航">
    <RouterLink
      v-for="[key, label] in sections"
      :key="key"
      :to="'/admin/' + key"
      class="tab"
      :class="{ active: section === key }"
      >{{ label }}</RouterLink
    >
  </nav>
  <AsyncState :loading="loading" :error="error" @retry="load">
    <div v-if="section === 'overview'" class="stats-grid">
      <div
        v-for="[key, label] in [
          ['users', '用户总数'],
          ['questions', '启用题目'],
          ['jobs', '启用岗位'],
          ['announcements', '启用公告'],
        ]"
        :key="key"
        class="stat-card"
      >
        <p class="muted">{{ label }}</p>
        <div class="stat-number">{{ overview[key!] ?? 0 }}</div>
      </div>
    </div>
    <template v-else>
      <section v-if="section === 'imports'" class="panel mb">
        <h2 class="mb">校验并导入数据</h2>
        <p class="notice">
          一次最多 1000 行 / 文件不超过 2MB。整批事务提交，任何一行失败则整批不写入。CSV/Excel 的
          options、correctAnswer、tags 等结构列填写 JSON 字符串。
        </p>
        <div class="toolbar">
          <label
            >数据类型<select v-model="kind" aria-label="数据类型" @change="result = undefined">
              <option value="questions">题库</option>
              <option value="jobs">岗位</option>
              <option value="announcements">公告</option>
            </select></label
          ><label
            >上传 JSON / CSV / Excel<input
              type="file"
              accept=".json,.csv,.xlsx"
              @change="file = ($event.target as HTMLInputElement).files?.[0]" /></label
          ><button
            class="button secondary"
            @click="
              file = undefined;
              importText = JSON.stringify([template()], null, 2);
            "
          >
            填入 JSON 模板
          </button>
        </div>
        <label
          >或直接粘贴 JSON 数组<textarea
            v-model="importText"
            class="json-editor"
            :disabled="!!file"
            aria-label="导入 JSON 数组"
          ></textarea></label
        ><button class="button mt" :disabled="busy" @click="runImport">
          <Upload :size="16" />{{ busy ? '正在校验…' : '校验并导入' }}
        </button>
        <div v-if="result" class="mt" aria-live="polite">
          <p :class="result.status === 'completed' ? 'form-success' : 'form-error'">
            {{ result.status === 'completed' ? '导入成功' : '导入失败，未写入业务数据' }} · 已导入
            {{ result.imported }} 行
          </p>
          <div v-for="e in result.errors" :key="e.row + e.message" class="match-line">
            第 {{ e.row }} 行：{{ e.message }}
          </div>
          <button
            v-if="result.errors.length"
            class="button secondary mt"
            @click="download('/admin/imports/' + result.id + '/errors', 'import-errors.csv')"
          >
            导出错误明细
          </button>
        </div>
        <hr style="border: 0; border-top: 1px solid var(--line); margin: 28px 0" />
        <h2 class="mb">按页导出数据</h2>
        <div class="toolbar">
          <label
            >格式<select v-model="format">
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
              <option value="xlsx">Excel</option>
            </select></label
          ><label>数据页码<input v-model.number="page" type="number" min="1" /></label
          ><button
            class="button secondary"
            @click="
              download(
                '/admin/exports/' + kind + '?format=' + format + '&page=' + page + '&pageSize=100',
                kind + '-page' + page + '.' + format,
              )
            "
          >
            <Download :size="16" />导出当前页（100 条）
          </button>
        </div>
      </section>
      <section class="panel table-wrap">
        <p v-if="!rows.length" class="muted">暂无记录</p>
        <table v-else>
          <thead>
            <tr>
              <th>内容 / 对象</th>
              <th>状态 / 分类</th>
              <th>更新时间</th>
              <th v-if="editable || section === 'users' || section === 'imports'">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="String(row.id)">
              <td>
                <strong>{{ row.title ?? row.name ?? row.email ?? row.action ?? row.kind ?? row.id }}</strong>
                <p v-if="row.objectId" class="muted" style="font-size: 11px">{{ row.objectId }}</p>
                <p v-if="section === 'questions'" class="muted" style="font-size: 11px">
                  标签：{{ (row.tags as string[])?.join('、') || '无' }}
                </p>
                <p v-if="section === 'imports'" class="muted">共 {{ row.total }} 行</p>
              </td>
              <td>
                <DataBadge
                  v-if="
                    ['demo', 'pending', 'verified', 'expired'].includes(
                      String(row.status ?? row.verification),
                    )
                  "
                  :status="String(row.status ?? row.verification)"
                /><span v-else>{{ row.role ?? row.subject ?? row.status ?? row.result ?? '—' }}</span
                ><span v-if="row.enabled === false || row.active === false" class="badge expired"
                  >已停用</span
                >
              </td>
              <td style="font-size: 12px">
                {{ new Date(String(row.updatedAt ?? row.createdAt)).toLocaleString('zh-CN') }}
              </td>
              <td v-if="editable || section === 'users' || section === 'imports'">
                <div class="actions">
                  <template v-if="editable">
                    <button class="button secondary small" @click="edit(row)">编辑</button
                    ><button v-if="section !== 'sources'" class="button ghost small" @click="remove(row)">
                      {{ section === 'categories' ? '删除' : '停用' }}
                    </button>
</template
                  ><template v-if="section === 'users'">
                    <button class="button secondary small" @click="changeUser(row, 'active')">
                      {{ row.active ? '禁用' : '启用' }}
</button
                    ><button class="button ghost small" @click="changeUser(row, 'role')">
                      {{ row.role === 'admin' ? '降为用户' : '设为管理员' }}
                    </button>
</template
                  ><button
                    v-if="section === 'imports' && row.status === 'failed'"
                    class="button secondary small"
                    @click="download('/admin/imports/' + row.id + '/errors', 'import-errors.csv')"
                  >
                    错误明细
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <div v-if="total > 20" class="pagination">
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
          :disabled="page * 20 >= total"
          @click="
            page++;
            load();
          "
        >
          下一页
        </button>
      </div>
    </template>
</AsyncState
  ><ElDialog
    v-model="editor"
    :title="editId ? '编辑内容' : '新增内容'"
    width="min(720px, 94vw)"
    :close-on-click-modal="false"
  >
    <p class="notice">
      结构化编辑器：后端会严格校验每个字段。题目标签在 tags 中维护。正文支持段落、**加粗**、*斜体*、`代码`、#
      标题与 > 引用，不执行 HTML。删除 JSON 中的 id 和时间字段不会影响系统记录。
    </p>
    <details class="mb">
      <summary>查看可用分类与来源 ID</summary>
      <p v-for="c in categories" :key="c.id">{{ c.name }}：{{ c.id }}</p>
      <p v-for="s in sources" :key="s.id">{{ s.name }}：{{ s.id }}</p>
    </details>
    <label>内容 JSON<textarea v-model="text" class="json-editor" spellcheck="false"></textarea></label
    ><template #footer>
      <button class="button secondary" @click="editor = false">取消</button
      ><button class="button" style="margin-left: 12px" :disabled="busy" @click="save">
        {{ busy ? '正在保存…' : '保存内容' }}
      </button>
    </template>
  </ElDialog>
</template>
