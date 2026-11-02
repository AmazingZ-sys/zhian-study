import { z } from 'zod';

export const idSchema = z.uuid();
export const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const passwordSchema = z.string().min(10, '密码至少 10 位').max(128);
export const authSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(40).optional(),
  client: z.enum(['web', 'mobile']).default('web'),
  device: z.string().max(100).default('Web'),
});
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const safeUrl = z
  .url()
  .max(2000)
  .refine((v) => ['http:', 'https:'].includes(new URL(v).protocol), '仅允许 HTTP(S) 地址');
export const statusSchema = z.enum(['demo', 'pending', 'verified', 'expired']);
export const educationLevels = ['不限', '高中', '大专', '本科', '硕士', '博士'] as const;
export const profileSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  avatarUrl: safeUrl.or(z.literal('')).optional(),
  examType: z.string().max(40).default('省考'),
  targetYear: z.number().int().min(2020).max(2100).default(2027),
  province: z.string().max(40).default(''),
  city: z.string().max(40).default(''),
  education: z.enum(educationLevels).default('本科'),
  degree: z.string().max(40).default(''),
  major: z.string().max(100).default(''),
  politicalStatus: z.string().max(40).default(''),
  workYears: z.number().min(0).max(60).default(0),
  age: z.number().int().min(16).max(80).nullable().default(null),
  dailyGoal: z.number().int().min(1).max(500).default(30),
});
export const categorySchema = z.object({
  name: z.string().min(1).max(80),
  subject: z.string().min(1).max(80),
  parentId: idSchema.nullable().default(null),
  sort: z.number().int().default(0),
});
export const optionSchema = z.object({ key: z.string().regex(/^[A-H]$/), text: z.string().min(1).max(5000) });
export const questionSchema = z
  .object({
    title: z.string().min(1).max(10000),
    examType: z.string().max(40).default('行测'),
    subject: z.string().min(1).max(80),
    categoryId: idSchema,
    type: z.enum(['single', 'multiple', 'boolean']).default('single'),
    options: z.array(optionSchema).min(2).max(8),
    correctAnswer: z
      .array(z.string().regex(/^[A-H]$/))
      .min(1)
      .max(8),
    explanation: z.string().min(1).max(20000),
    difficulty: z.number().int().min(1).max(5).default(2),
    tags: z.array(z.string().max(40)).max(20).default([]),
    sourceId: idSchema.nullable().default(null),
    sourceLabel: z.string().min(1).max(200),
    status: statusSchema.default('pending'),
    enabled: z.boolean().default(true),
    year: z.number().int().min(1990).max(2100).nullable().default(null),
    imageUrl: safeUrl.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    const keys = new Set(v.options.map((o) => o.key));
    if (
      keys.size !== v.options.length ||
      new Set(v.correctAnswer).size !== v.correctAnswer.length ||
      v.correctAnswer.some((k) => !keys.has(k)) ||
      (v.type !== 'multiple' && v.correctAnswer.length !== 1) ||
      (v.type === 'boolean' && v.options.length !== 2)
    )
      ctx.addIssue({ code: 'custom', message: '选项与答案不一致' });
  });
export const answerSchema = z.object({
  answer: z
    .array(z.string().regex(/^[A-H]$/))
    .min(1)
    .max(8),
  seconds: z.number().int().min(0).max(7200),
  requestId: idSchema,
  sessionId: idSchema.optional(),
});
export const examCreateSchema = z.object({
  title: z.string().min(1).max(100).default('自定义模拟考试'),
  count: z.number().int().min(1).max(100).default(10),
  minutes: z.number().int().min(1).max(180).default(30),
  points: z.number().int().min(1).max(100).default(5),
  categoryId: idSchema.optional(),
});
export const examAnswerSchema = z.object({
  questionId: idSchema,
  answer: z.array(z.string().regex(/^[A-H]$/)).max(8),
});
export const jobSchema = z
  .object({
    year: z.number().int().min(2020).max(2100),
    examType: z.string().min(1).max(40),
    province: z.string().min(1).max(40),
    city: z.string().max(40).default(''),
    district: z.string().max(40).default(''),
    organization: z.string().min(1).max(200),
    department: z.string().max(200).default(''),
    title: z.string().min(1).max(200),
    code: z.string().min(1).max(100),
    headcount: z.number().int().min(1).max(10000),
    education: z.enum(educationLevels).default('不限'),
    degree: z.string().max(80).default('不限'),
    majorCodes: z.array(z.string().max(40)).max(200).default([]),
    majorText: z.string().max(2000).default('不限'),
    majorCategory: z.string().max(100).default(''),
    politicalStatus: z.string().max(100).default('不限'),
    workYears: z.number().min(0).max(60).default(0),
    minAge: z.number().int().min(16).max(80).default(18),
    maxAge: z.number().int().min(16).max(80).default(35),
    otherRequirements: z.string().max(10000).default(''),
    registrationStart: z.iso.datetime().nullable().default(null),
    registrationEnd: z.iso.datetime().nullable().default(null),
    examAt: z.iso.datetime().nullable().default(null),
    sourceId: idSchema.nullable().default(null),
    sourceUrl: safeUrl,
    sourceLabel: z.string().min(1).max(200),
    publishedAt: z.iso.datetime(),
    status: statusSchema.default('pending'),
    enabled: z.boolean().default(true),
  })
  .refine((v) => v.minAge <= v.maxAge, '年龄范围不合法')
  .refine(
    (v) => !v.registrationStart || !v.registrationEnd || v.registrationStart <= v.registrationEnd,
    '报名日期范围不合法',
  )
  .refine((v) => v.status !== 'verified' || !!v.sourceId, '已核验数据必须关联来源');
export const announcementSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(100000),
    type: z.string().min(1).max(80),
    examType: z.string().min(1).max(40),
    province: z.string().max(40).default('全国'),
    sourceId: idSchema.nullable().default(null),
    sourceUrl: safeUrl,
    sourceLabel: z.string().min(1).max(200),
    publishedAt: z.iso.datetime(),
    attachments: z
      .array(z.object({ name: z.string().max(200), url: safeUrl }))
      .max(20)
      .default([]),
    status: statusSchema.default('pending'),
    enabled: z.boolean().default(true),
  })
  .refine((v) => v.status !== 'verified' || !!v.sourceId, '已核验数据必须关联来源');
export const sourceSchema = z.object({
  name: z.string().min(1).max(200),
  url: safeUrl,
  terms: z.string().max(10000).default('待人工确认'),
  verification: statusSchema.default('pending'),
  version: z.string().max(100).default('1'),
  fetchedAt: z.iso.datetime().nullable().default(null),
});
export const planSchema = z.object({
  title: z.string().min(1).max(100),
  target: z.number().int().min(1).max(100000),
  dueDate: z.iso.date(),
  completed: z.boolean().default(false),
});
export type Profile = z.infer<typeof profileSchema>;
export type QuestionInput = z.infer<typeof questionSchema>;
export type JobInput = z.infer<typeof jobSchema>;
export type AnnouncementInput = z.infer<typeof announcementSchema>;
export type SourceInput = z.infer<typeof sourceSchema>;
export type User = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  avatarUrl: string | null;
};
export type Question = Omit<QuestionInput, 'correctAnswer' | 'explanation'> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  favorite?: boolean;
  wrongCount?: number;
  mastered?: boolean;
  note?: string;
};
export type AnswerResult = {
  id: string;
  correct: boolean;
  correctAnswer: string[];
  explanation: string;
  answer: string[];
  seconds: number;
  createdAt: string;
};
export type Job = JobInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  favorite?: boolean;
};
export type Announcement = AnnouncementInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  favorite?: boolean;
};
export type PageMeta = { total: number; page: number; pageSize: number };
export type Envelope<T> = { data: T; meta?: PageMeta };
export type Category = z.infer<typeof categorySchema> & { id: string; count: number };
export type MatchResult = {
  status: '符合' | '不符合' | '需要人工确认';
  reasons: { field: string; status: '符合' | '不符合' | '需要人工确认'; message: string }[];
  disclaimer: string;
};
export type Overview = {
  total: number;
  correct: number;
  accuracy: number;
  seconds: number;
  streak: number;
  today: number;
  wrong: number;
  favorites: number;
  exams: number;
  dailyGoal: number;
};
export type DailyStat = { date: string; total: number; correct: number; seconds: number; wrong: number };
export type SubjectStat = { subject: string; total: number; correct: number; accuracy: number };
export type Exam = {
  id: string;
  title: string;
  status: 'active' | 'submitted';
  startedAt: string;
  deadline: string;
  submittedAt: string | null;
  serverNow: string;
  points: number;
  score: number | null;
  total: number;
  questions: (Question & {
    answer: string[];
    correctAnswer?: string[];
    explanation?: string;
    correct?: boolean;
  })[];
  subjects?: SubjectStat[];
};
