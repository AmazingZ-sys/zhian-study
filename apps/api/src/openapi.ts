import { z } from 'zod';
import {
  authSchema,
  profileSchema,
  questionSchema,
  jobSchema,
  announcementSchema,
  answerSchema,
  examCreateSchema,
  examAnswerSchema,
  sourceSchema,
  categorySchema,
  planSchema,
} from '@zhian/contracts';
const json = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' });
const base = { id: z.uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() };
const user = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: z.enum(['user', 'admin']),
  avatarUrl: z.string().nullable(),
});
const question = z.object(questionSchema.shape).omit({ correctAnswer: true, explanation: true }).extend(base);
const answer = z.object({
  id: z.uuid(),
  correct: z.boolean(),
  correctAnswer: z.array(z.string()),
  explanation: z.string(),
  answer: z.array(z.string()),
  seconds: z.number(),
  createdAt: z.iso.datetime(),
});
export const schemas = {
  Auth: json(authSchema),
  Profile: json(profileSchema),
  QuestionInput: json(questionSchema),
  JobInput: json(jobSchema),
  AnnouncementInput: json(announcementSchema),
  AnswerInput: json(answerSchema),
  ExamCreate: json(examCreateSchema),
  ExamAnswer: json(examAnswerSchema),
  Source: json(sourceSchema),
  Category: json(categorySchema),
  Plan: json(planSchema),
  User: json(user),
  AuthResult: json(
    z.object({ user, expiresIn:z.number(), accessToken: z.string().optional(), refreshToken: z.string().optional() }),
  ),
  TokenResult: json(z.object({expiresIn:z.number(),accessToken:z.string().optional(),refreshToken:z.string().optional()})),
  UserProfile: json(z.object({ user, profile: profileSchema })),
  Question: json(
    question.extend({
      favorite: z.boolean().optional(),
      note: z.string().optional(),
      mastered: z.boolean().optional(),
      wrongCount: z.number().optional(),
    }),
  ),
  AnswerResult: json(answer),
  Job: json(
    z.object(jobSchema.shape).extend({ ...base, version: z.number(), favorite: z.boolean().optional() }),
  ),
  Announcement: json(
    z.object(announcementSchema.shape).extend({ ...base, favorite: z.boolean().optional() }),
  ),
  CategoryRecord: json(categorySchema.extend({ ...base, count: z.number().optional() })),
  SourceRecord: json(sourceSchema.extend(base)),
  PlanRecord: json(planSchema.extend({ ...base, userId: z.uuid() })),
  Overview: json(
    z.object({
      total: z.number(),
      correct: z.number(),
      seconds: z.number(),
      today: z.number(),
      accuracy: z.number(),
      streak: z.number(),
      wrong: z.number(),
      favorites: z.number(),
      exams: z.number(),
      dailyGoal: z.number(),
    }),
  ),
  DailyStat: json(
    z.object({
      date: z.string(),
      total: z.number(),
      correct: z.number(),
      wrong: z.number(),
      seconds: z.number(),
    }),
  ),
  SubjectStat: json(
    z.object({ subject: z.string(), total: z.number(), correct: z.number(), accuracy: z.number() }),
  ),
  PasswordInput: json(z.object({ currentPassword: z.string(), newPassword: z.string().min(10).max(128) })),
  NoteInput: json(z.object({ note: z.string().max(10000) })),
  MasteredInput: json(z.object({ mastered: z.boolean() })),
  MatchInput: json(z.object({ jobId: z.uuid() })),
  RefreshInput: json(
    z.object({ refreshToken: z.string().optional(), client: z.enum(['web', 'mobile']).default('web') }),
  ),
};
const paths: Record<string, Record<string, unknown>> = {};
function route(
  path: string,
  method: string,
  summary: string,
  input?: keyof typeof schemas,
  publicRoute = false,
) {
  const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    in: 'path',
    name: m[1],
    required: true,
    schema: { type: 'string', format: 'uuid' },
  }));
  paths[path] ??= {};
  paths[path]![method] = {
    summary,
    operationId: method + path.replace(/[^a-zA-Z]/g, '_'),
    security: publicRoute ? [] : [{ cookieAuth: [] }, { bearerAuth: [] }],
    parameters: params,
    ...(input
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: `#/components/schemas/${input}` } } },
          },
        }
      : {}),
    responses: {
      200: {
        description: '成功；返回 data，列表另含 meta',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                data: {},
                meta: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer' },
                    page: { type: 'integer' },
                    pageSize: { type: 'integer' },
                  },
                },
              },
              required: ['data'],
            },
          },
        },
      },
      400: { description: '参数校验失败' },
      401: { description: '未登录' },
      403: { description: '无权限或来源不可信' },
      404: { description: '不存在' },
      409: { description: '冲突' },
      429: { description: '请求过快' },
    },
  };
}
for (const name of ['register', 'login'])
  route('/auth/' + name, 'post', name === 'register' ? '注册' : '登录', 'Auth', true);
route('/auth/refresh', 'post', '轮换刷新令牌', 'RefreshInput', true);
route('/auth/logout', 'post', '撤销会话');
route('/auth/me', 'get', '当前身份');
route('/users/me', 'get', '用户资料');
route('/users/me', 'patch', '更新资料', 'Profile');
route('/users/me/password', 'patch', '修改密码并撤销所有会话', 'PasswordInput');
route('/users/me/sessions', 'get', '登录设备');
route('/users/me/sessions/{id}', 'delete', '撤销设备');
route('/question-categories', 'get', '分类树', undefined, true);
route('/questions', 'get', '题库检索', undefined, true);
route('/questions/{id}', 'get', '题目（不含答案）', undefined, true);
route('/questions/{id}/answer', 'post', '提交答案', 'AnswerInput');
route('/questions/{id}/history', 'get', '答题历史');
route('/questions/{id}/note', 'patch', '更新笔记', 'NoteInput');
route('/wrong-questions', 'get', '错题列表');
route('/wrong-questions/{id}/retry', 'post', '错题重做');
route('/wrong-questions/{id}/mastered', 'patch', '标记掌握', 'MasteredInput');
for (const resource of ['questions', 'jobs', 'announcements'])
  for (const method of ['post', 'delete'])
    route(`/${resource}/{id}/favorite`, method, method === 'post' ? '收藏' : '取消收藏');
route('/exams', 'get', '我的考试');
route('/exams', 'post', '创建考试', 'ExamCreate');
route('/exams/{id}', 'get', '考试状态');
route('/exams/{id}/answers', 'patch', '暂存考试答案', 'ExamAnswer');
route('/exams/{id}/submit', 'post', '交卷');
route('/exams/{id}/result', 'get', '成绩报告');
for (const part of ['overview', 'daily', 'subjects', 'recent'])
  route('/statistics/' + part, 'get', '学习统计');
for (const resource of ['jobs', 'announcements']) {
  route('/' + resource, 'get', '公开检索', undefined, true);
  route('/' + resource + '/{id}', 'get', '公开详情', undefined, true);
}
route('/jobs/favorites', 'get', '收藏岗位');
route('/jobs/{id}/history', 'get', '岗位历史', undefined, true);
route('/jobs/match', 'post', '报考条件三态匹配', 'MatchInput');
route('/major-catalog', 'get', '专业目录', undefined, true);
route('/reminders', 'get', '站内截止提醒');
route('/reminders/{id}', 'patch', '已读提醒');
route('/study-plans', 'get', '学习计划');
route('/study-plans', 'post', '新计划', 'Plan');
route('/study-plans/{id}', 'patch', '修改计划', 'Plan');
route('/study-plans/{id}', 'delete', '删除计划');
for (const [resource, input] of [
  ['questions', 'QuestionInput'],
  ['jobs', 'JobInput'],
  ['announcements', 'AnnouncementInput'],
  ['categories', 'Category'],
  ['sources', 'Source'],
] as const) {
  route('/admin/' + resource, 'get', '管理员列表');
  route('/admin/' + resource, 'post', '管理员新增', input);
  route('/admin/' + resource + '/{id}', 'patch', '管理员修改', input);
  if (resource !== 'sources') route('/admin/' + resource + '/{id}', 'delete', '管理员删除/停用');
}
for (const part of ['overview', 'users', 'audit-logs', 'imports']) route('/admin/' + part, 'get', '管理查询');
route('/admin/users/{id}', 'patch', '角色与状态');
route('/admin/imports', 'post', '事务导入 JSON 或 multipart 文件');
route('/admin/imports/{id}/errors', 'get', '导出错误 CSV');
route('/practice-sessions', 'post', '建立练习会话');
route('/admin/exports/{kind}', 'get', '分页导出 JSON/CSV/XLSX');
// Specific response contracts replace generic envelopes for the shared public client.
function response(path: string, method: string, schema: keyof typeof schemas, list = false, status = 200) {
  const operation = paths[path]![method] as { responses: Record<number, unknown> };
  delete operation.responses[200];
  const item = { $ref: `#/components/schemas/${schema}` };
  const envelope = {
    type: 'object',
    required: ['data'],
    properties: {
      data: list ? { type: 'array', items: item } : item,
      meta: {
        type: 'object',
        required: ['page', 'pageSize', 'total'],
        properties: {
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          total: { type: 'integer' },
        },
      },
    },
  };
  operation.responses[status] = {
    description: '成功',
    content: { 'application/json': { schema: envelope } },
  };
}
for (const method of ['register', 'login', 'refresh'])
  response('/auth/' + method, 'post', method === 'refresh' ? 'TokenResult' : 'AuthResult', false, method === 'register' ? 201 : 200);
response('/users/me', 'get', 'UserProfile');
response('/users/me', 'patch', 'Profile');
response('/auth/me', 'get', 'User');
response('/questions', 'get', 'Question', true);
response('/questions/{id}', 'get', 'Question');
response('/questions/{id}/answer', 'post', 'AnswerResult');
response('/questions/{id}/history', 'get', 'AnswerResult', true);
response('/wrong-questions', 'get', 'Question', true);
response('/question-categories', 'get', 'CategoryRecord', true);
response('/statistics/overview', 'get', 'Overview');
response('/statistics/daily', 'get', 'DailyStat', true);
response('/statistics/subjects', 'get', 'SubjectStat', true);
for (const [resource, schema] of [
  ['jobs', 'Job'],
  ['announcements', 'Announcement'],
] as const) {
  response('/' + resource, 'get', schema, true);
  response('/' + resource + '/{id}', 'get', schema);
}
response('/jobs/favorites', 'get', 'Job', true);
response('/study-plans', 'get', 'PlanRecord', true);
response('/study-plans', 'post', 'PlanRecord', false, 201);
response('/study-plans/{id}', 'patch', 'PlanRecord');
const queryFields: Record<string, Record<string, unknown>> = {
  page: { type: 'integer', minimum: 1 },
  pageSize: { type: 'integer', minimum: 1, maximum: 100 },
  q: { type: 'string', maxLength: 100 },
  categoryId: { type: 'string', format: 'uuid' },
  subject: { type: 'string' },
  year: { type: 'integer' },
  mode: { type: 'string', enum: ['sequential', 'random', 'chapter', 'special', 'past', 'favorite', 'wrong'] },
  after: { type: 'string', format: 'uuid' },
  province: { type: 'string' },
  city: { type: 'string' },
  examType: { type: 'string' },
  education: { type: 'string' },
  degree: { type: 'string' },
  major: { type: 'string' },
  politicalStatus: { type: 'string' },
  organization: { type: 'string' },
  minHeadcount: { type: 'integer' },
  workYears: { type: 'number' },
  type: { type: 'string' },
  favorite: { type: 'string', enum: ['true', 'false'] },
  sort: { type: 'string' },
  since: { type: 'string', format: 'date-time' },
  mastered: { type: 'string', enum: ['true', 'false'] },
};
for (const [path, fields] of Object.entries({
  '/questions': ['page', 'pageSize', 'q', 'categoryId', 'subject', 'year', 'mode', 'after'],
  '/wrong-questions': ['page', 'pageSize', 'categoryId', 'subject', 'sort', 'since', 'mastered'],
  '/jobs': [
    'page',
    'pageSize',
    'q',
    'year',
    'province',
    'city',
    'examType',
    'education',
    'degree',
    'major',
    'politicalStatus',
    'organization',
    'minHeadcount',
    'workYears',
    'sort',
  ],
  '/announcements': ['page', 'pageSize', 'q', 'province', 'examType', 'type', 'favorite'],
  '/exams': ['page', 'pageSize'],
  '/jobs/favorites': ['page', 'pageSize'],
  '/study-plans': ['page', 'pageSize'],
})) {
  const operation = paths[path]!.get as { parameters: unknown[] };
  operation.parameters.push(
    ...fields.map((name) => ({ name, in: 'query', required: false, schema: queryFields[name] })),
  );
}
const exportOp = paths['/admin/exports/{kind}']!.get as { parameters: unknown[] };
exportOp.parameters = [
  {
    name: 'kind',
    in: 'path',
    required: true,
    schema: { type: 'string', enum: ['questions', 'jobs', 'announcements'] },
  },
  { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv', 'xlsx'] } },
  { name: 'page', in: 'query', schema: queryFields.page },
  { name: 'pageSize', in: 'query', schema: queryFields.pageSize },
];
export const openapi = {
  openapi: '3.1.0',
  info: {
    title: '知岸公考 API',
    version: '1.0.0',
    description: '输入由 Zod 生成；部分响应与查询参数仍使用通用 envelope，详见 API_SPEC。',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    schemas,
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'zhian_access' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  paths,
};
