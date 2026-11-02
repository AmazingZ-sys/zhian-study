import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  real,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { Profile, QuestionInput, JobInput, AnnouncementInput } from '@zhian/contracts';
const base = () => ({
  id: uuid('id').defaultRandom().primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const users = pgTable('users', {
  ...base(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').$type<'user' | 'admin'>().default('user').notNull(),
  active: boolean('active').default(true).notNull(),
  avatarUrl: text('avatar_url'),
});
export const profiles = pgTable('user_profiles', {
  ...base(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  data: jsonb('data').$type<Profile>().notNull(),
});
export const authSessions = pgTable(
  'auth_sessions',
  {
    ...base(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    refreshHash: text('refresh_hash').notNull(),
    usedHashes: jsonb('used_hashes').$type<string[]>().default([]).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    device: text('device').notNull(),
  },
  (t) => [index('sessions_user').on(t.userId), uniqueIndex('sessions_hash').on(t.refreshHash)],
);
export const sources = pgTable('content_sources', {
  ...base(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  terms: text('terms').notNull(),
  verification: text('verification').notNull(),
  version: text('version').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),
});
export const categories = pgTable('question_categories', {
  ...base(),
  name: text('name').notNull().unique(),
  subject: text('subject').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => categories.id),
  sort: integer('sort').default(0).notNull(),
});
export const questions = pgTable(
  'questions',
  {
    ...base(),
    title: text('title').notNull(),
    examType: text('exam_type').notNull(),
    subject: text('subject').notNull(),
    categoryId: uuid('category_id')
      .references(() => categories.id)
      .notNull(),
    type: text('type').$type<QuestionInput['type']>().notNull(),
    correctAnswer: jsonb('correct_answer').$type<string[]>().notNull(),
    explanation: text('explanation').notNull(),
    difficulty: integer('difficulty').notNull(),
    tags: jsonb('tags').$type<string[]>().default([]).notNull(),
    sourceId: uuid('source_id').references(() => sources.id),
    sourceLabel: text('source_label').notNull(),
    status: text('status').$type<QuestionInput['status']>().notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    year: integer('year'),
    imageUrl: text('image_url'),
  },
  (t) => [index('questions_category').on(t.categoryId), index('questions_subject').on(t.subject)],
);
export const options = pgTable(
  'question_options',
  {
    ...base(),
    questionId: uuid('question_id')
      .references(() => questions.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    text: text('text').notNull(),
  },
  (t) => [uniqueIndex('option_question_key').on(t.questionId, t.key)],
);
export const questionStates = pgTable(
  'user_question_states',
  {
    ...base(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    questionId: uuid('question_id')
      .references(() => questions.id)
      .notNull(),
    favorite: boolean('favorite').default(false).notNull(),
    wrongCount: integer('wrong_count').default(0).notNull(),
    mastered: boolean('mastered').default(false).notNull(),
    note: text('note').default('').notNull(),
  },
  (t) => [
    uniqueIndex('state_user_question').on(t.userId, t.questionId),
    index('state_user_wrong').on(t.userId, t.wrongCount),
  ],
);
export const practiceSessions = pgTable('practice_sessions', {
  ...base(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  mode: text('mode').notNull(),
  categoryId: uuid('category_id').references(() => categories.id),
});
export const practiceAnswers = pgTable(
  'practice_answers',
  {
    ...base(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    questionId: uuid('question_id')
      .references(() => questions.id)
      .notNull(),
    sessionId: uuid('session_id').references(() => practiceSessions.id),
    requestId: uuid('request_id').notNull(),
    answer: jsonb('answer').$type<string[]>().notNull(),
    correct: boolean('correct').notNull(),
    seconds: integer('seconds').notNull(),
    correctAnswer: jsonb('correct_answer').$type<string[]>().notNull(),
    explanation: text('explanation').notNull(),
  },
  (t) => [
    uniqueIndex('answer_idempotency').on(t.userId, t.requestId),
    index('answers_user_time').on(t.userId, t.createdAt),
  ],
);
export const papers = pgTable('exam_papers', {
  ...base(),
  title: text('title').notNull(),
  minutes: integer('minutes').notNull(),
  points: integer('points').notNull(),
});
export const paperQuestions = pgTable(
  'exam_paper_questions',
  {
    ...base(),
    paperId: uuid('paper_id')
      .references(() => papers.id)
      .notNull(),
    questionId: uuid('question_id')
      .references(() => questions.id)
      .notNull(),
    position: integer('position').notNull(),
    snapshot: jsonb('snapshot').$type<QuestionInput & { id: string }>().notNull(),
  },
  (t) => [uniqueIndex('paper_question').on(t.paperId, t.questionId)],
);
export const attempts = pgTable(
  'exam_attempts',
  {
    ...base(),
    paperId: uuid('paper_id')
      .references(() => papers.id)
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    status: text('status').$type<'active' | 'submitted'>().default('active').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    deadline: timestamp('deadline', { withTimezone: true }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    score: real('score'),
  },
  (t) => [
    index('attempt_user_time').on(t.userId, t.createdAt),
    index('attempt_deadline').on(t.status, t.deadline),
  ],
);
export const examAnswers = pgTable(
  'exam_answers',
  {
    ...base(),
    attemptId: uuid('attempt_id')
      .references(() => attempts.id)
      .notNull(),
    questionId: uuid('question_id')
      .references(() => questions.id)
      .notNull(),
    answer: jsonb('answer').$type<string[]>().notNull(),
    correct: boolean('correct'),
  },
  (t) => [uniqueIndex('exam_answer_unique').on(t.attemptId, t.questionId)],
);
export const jobs = pgTable(
  'jobs',
  {
    ...base(),
    year: integer('year').notNull(),
    examType: text('exam_type').notNull(),
    province: text('province').notNull(),
    city: text('city').notNull(),
    organization: text('organization').notNull(),
    title: text('title').notNull(),
    code: text('code').notNull(),
    headcount: integer('headcount').notNull(),
    education: text('education').notNull(),
    status: text('status').$type<JobInput['status']>().notNull(),
    sourceId: uuid('source_id').references(() => sources.id),
    enabled: boolean('enabled').notNull().default(true),
    version: integer('version').notNull().default(1),
    data: jsonb('data').$type<JobInput>().notNull(),
  },
  (t) => [
    uniqueIndex('job_code_year_org').on(t.code, t.year, t.organization),
    index('job_region_year').on(t.province, t.year),
  ],
);
export const jobVersions = pgTable(
  'job_versions',
  {
    ...base(),
    jobId: uuid('job_id')
      .references(() => jobs.id)
      .notNull(),
    version: integer('version').notNull(),
    data: jsonb('data').$type<JobInput>().notNull(),
  },
  (t) => [uniqueIndex('job_version_unique').on(t.jobId, t.version)],
);
export const jobFavorites = pgTable(
  'job_favorites',
  {
    ...base(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    jobId: uuid('job_id')
      .references(() => jobs.id)
      .notNull(),
  },
  (t) => [uniqueIndex('job_favorite_unique').on(t.userId, t.jobId)],
);
export const announcements = pgTable(
  'announcements',
  {
    ...base(),
    title: text('title').notNull(),
    type: text('type').notNull(),
    examType: text('exam_type').notNull(),
    province: text('province').notNull(),
    sourceId: uuid('source_id').references(() => sources.id),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    status: text('status').$type<AnnouncementInput['status']>().notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    data: jsonb('data').$type<AnnouncementInput>().notNull(),
  },
  (t) => [index('announcement_region_time').on(t.province, t.publishedAt)],
);
export const announcementFavorites = pgTable(
  'announcement_favorites',
  {
    ...base(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    announcementId: uuid('announcement_id')
      .references(() => announcements.id)
      .notNull(),
  },
  (t) => [uniqueIndex('announcement_favorite_unique').on(t.userId, t.announcementId)],
);
export const imports = pgTable('import_jobs', {
  ...base(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  total: integer('total').notNull(),
  errors: jsonb('errors').$type<{ row: number; message: string }[]>().default([]).notNull(),
});
export const auditLogs = pgTable(
  'audit_logs',
  {
    ...base(),
    userId: uuid('user_id').references(() => users.id),
    action: text('action').notNull(),
    objectId: text('object_id').notNull(),
    result: text('result').notNull(),
  },
  (t) => [index('audit_time').on(t.createdAt)],
);
export const majors = pgTable('major_catalog', {
  ...base(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  aliases: jsonb('aliases').$type<string[]>().default([]).notNull(),
  version: text('version').notNull(),
});
export const studyPlans = pgTable('study_plans', {
  ...base(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  title: text('title').notNull(),
  target: integer('target').notNull(),
  dueDate: text('due_date').notNull(),
  completed: boolean('completed').default(false).notNull(),
});
export const reminders = pgTable(
  'reminders',
  {
    ...base(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    jobId: uuid('job_id')
      .references(() => jobs.id)
      .notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    read: boolean('read').default(false).notNull(),
  },
  (t) => [uniqueIndex('reminder_user_job').on(t.userId, t.jobId)],
);
