/** Import only the versioned export produced by export-question-bank.py. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { z } from 'zod';

const uuid = z.uuid();
const raw = z.record(z.string(), z.unknown());
const manifestSchema = z.object({
  formatVersion: z.literal(1),
  sourceKey: z.literal('kaogong-shuati'),
  sourceId: uuid,
  sourceRevision: z.string().min(1),
  sourceUrl: z.string().min(1),
  exportedAt: z.iso.datetime({ offset: true }),
  counts: z.object({
    questions: z.int().nonnegative(),
    objective: z.int().nonnegative(),
    subjective: z.int().nonnegative(),
    options: z.int().nonnegative(),
    papers: z.int().nonnegative(),
    paperQuestions: z.int().nonnegative(),
    categories: z.int().nonnegative(),
  }),
  files: z.record(
    z.string(),
    z.object({ bytes: z.int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  ),
});
const categorySchema = z.object({
  id: uuid,
  name: z.string().min(1),
  subject: z.string().min(1),
  parentId: uuid.nullable(),
  sort: z.int(),
});
const questionSchema = z
  .object({
    id: uuid,
    externalKey: z.string().startsWith('kaogong-shuati:'),
    title: z.string().min(1),
    examType: z.string().min(1),
    subject: z.string().min(1),
    categoryId: uuid,
    type: z.enum(['single', 'multiple', 'boolean', 'subjective']),
    correctAnswer: z.array(z.string().regex(/^[A-H]$/)),
    explanation: z.string().min(1),
    material: z.string(),
    difficulty: z.int().min(1).max(5),
    tags: z.array(z.string()),
    sourceId: uuid,
    sourceLabel: z.string().min(1),
    status: z.literal('pending'),
    enabled: z.literal(true),
    year: z.int().nullable(),
    imageUrl: z.string().nullable(),
    options: z.array(z.object({ id: uuid, key: z.string().regex(/^[A-H]$/), text: z.string().min(1) })),
  })
  .superRefine((question, context) => {
    const keys = question.options.map((option) => option.key);
    if (
      question.type === 'subjective'
        ? keys.length !== 0 || question.correctAnswer.length !== 0
        : keys.length < 2 ||
          keys.length > 8 ||
          new Set(keys).size !== keys.length ||
          !question.correctAnswer.length ||
          new Set(question.correctAnswer).size !== question.correctAnswer.length ||
          question.correctAnswer.some((key) => !keys.includes(key)) ||
          (question.type !== 'multiple' && question.correctAnswer.length !== 1) ||
          (question.type === 'boolean' && keys.length !== 2)
    ) {
      context.addIssue({ code: 'custom', message: 'Question options and answers do not agree' });
    }
  });
const paperSchema = z.object({
  id: uuid,
  externalKey: z.string().startsWith('kaogong-shuati:paper:'),
  sourceId: uuid,
  title: z.string().min(1),
  subject: z.string().min(1),
  category: z.string(),
  year: z.int().nullable(),
  questionCount: z.int().nonnegative(),
  materials: z.array(
    z.object({ title: z.string(), text: z.string(), pdf: z.string(), idx: z.int().nullable() }),
  ),
  raw,
});
const linkSchema = z.object({ id: uuid, paperId: uuid, questionId: uuid, position: z.int().min(1), raw });
type Manifest = z.infer<typeof manifestSchema>;

async function* records<T>(directory: string, file: string, schema: z.ZodType<T>) {
  const lines = createInterface({ input: createReadStream(resolve(directory, file)), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber++;
    if (!line.trim()) continue;
    try {
      yield schema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`${file}:${lineNumber}: ${error instanceof Error ? error.message : 'Invalid record'}`);
    }
  }
}

async function* batches<T>(records: AsyncIterable<T>, size = 250) {
  let batch: T[] = [];
  for await (const record of records) {
    batch.push(record);
    if (batch.length === size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

async function verifyFiles(directory: string, manifest: Manifest) {
  for (const file of ['categories.jsonl', 'questions.jsonl', 'papers.jsonl', 'paper-questions.jsonl']) {
    const expected = manifest.files[file];
    if (!expected) throw new Error(`Manifest is missing ${file}`);
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(resolve(directory, file))) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256)
      throw new Error(`Export integrity check failed: ${file}`);
  }
}

async function insert(
  client: pg.PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  conflict: string,
) {
  if (!rows.length) return;
  const parameters: unknown[] = [];
  const values = rows.map(
    (row) =>
      `(${row
        .map((value) => {
          parameters.push(value);
          return `$${parameters.length}`;
        })
        .join(',')})`,
  );
  // Identifiers and conflict clauses are constants below, never read from the export.
  const result = await client.query(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES ${values.join(',')} ${conflict} RETURNING id`,
    parameters,
  );
  if (result.rowCount !== rows.length) throw new Error(`${table}: source ownership or import count mismatch`);
}

function sourceGuard(sourceId: string, expected: string) {
  if (sourceId !== expected) throw new Error('Record belongs to a different content source');
}

export async function importQuestionBank(directory: string, connectionString: string) {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
  );
  await verifyFiles(directory, manifest);
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('zhian:question-bank:kaogong-shuati'))");
    const existingSource = await client.query('SELECT name, url FROM content_sources WHERE id=$1', [
      manifest.sourceId,
    ]);
    if (
      existingSource.rows.length &&
      (existingSource.rows[0].url !== manifest.sourceUrl ||
        existingSource.rows[0].name !== 'kaogong-shuati 本地题库')
    )
      throw new Error('Stable source UUID is occupied by unrelated data');
    await insert(
      client,
      'content_sources',
      ['id', 'name', 'url', 'terms', 'verification', 'version', 'fetched_at'],
      [
        [
          manifest.sourceId,
          'kaogong-shuati 本地题库',
          manifest.sourceUrl,
          '由用户指定的本地参考项目迁入；来源及快照保存在本地题库包 README 与 manifest；未逐题人工核验。',
          'pending',
          manifest.sourceRevision,
          manifest.exportedAt,
        ],
      ],
      'ON CONFLICT (id) DO UPDATE SET version=EXCLUDED.version,fetched_at=EXCLUDED.fetched_at,updated_at=now()',
    );
    const observed = {
      categories: 0,
      questions: 0,
      options: 0,
      papers: 0,
      paperQuestions: 0,
      objective: 0,
      subjective: 0,
    };
    const categoryIds = new Set<string>();
    const questionIds = new Set<string>();
    const paperIds = new Set<string>();
    for await (const batch of batches(records(directory, 'categories.jsonl', categorySchema))) {
      // Insert by level: every parent has to exist before its child is inserted.
      for (const category of batch) {
        if (categoryIds.has(category.id) || (category.parentId && !categoryIds.has(category.parentId)))
          throw new Error('Duplicate category or parent does not precede child');
        await insert(
          client,
          'question_categories',
          ['id', 'name', 'subject', 'parent_id', 'sort'],
          [[category.id, category.name, category.subject, category.parentId, category.sort]],
          'ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,subject=EXCLUDED.subject,parent_id=EXCLUDED.parent_id,sort=EXCLUDED.sort,updated_at=now()',
        );
        categoryIds.add(category.id);
      }
      observed.categories += batch.length;
    }
    for await (const batch of batches(records(directory, 'questions.jsonl', questionSchema))) {
      batch.forEach((question) => {
        sourceGuard(question.sourceId, manifest.sourceId);
        if (questionIds.has(question.id) || !categoryIds.has(question.categoryId))
          throw new Error('Duplicate question or category is outside this export');
        questionIds.add(question.id);
      });
      await insert(
        client,
        'questions',
        [
          'id',
          'external_key',
          'title',
          'exam_type',
          'subject',
          'category_id',
          'type',
          'correct_answer',
          'explanation',
          'material',
          'difficulty',
          'tags',
          'source_id',
          'source_label',
          'status',
          'enabled',
          'year',
          'image_url',
        ],
        batch.map((q) => [
          q.id,
          q.externalKey,
          q.title,
          q.examType,
          q.subject,
          q.categoryId,
          q.type,
          JSON.stringify(q.correctAnswer),
          q.explanation,
          q.material,
          q.difficulty,
          JSON.stringify(q.tags),
          q.sourceId,
          q.sourceLabel,
          q.status,
          q.enabled,
          q.year,
          q.imageUrl,
        ]),
        'ON CONFLICT (external_key) DO UPDATE SET title=EXCLUDED.title,exam_type=EXCLUDED.exam_type,subject=EXCLUDED.subject,category_id=EXCLUDED.category_id,type=EXCLUDED.type,correct_answer=EXCLUDED.correct_answer,explanation=EXCLUDED.explanation,material=EXCLUDED.material,difficulty=EXCLUDED.difficulty,tags=EXCLUDED.tags,source_label=EXCLUDED.source_label,year=EXCLUDED.year,image_url=EXCLUDED.image_url,updated_at=CASE WHEN (questions.title,questions.exam_type,questions.subject,questions.category_id,questions.type,questions.correct_answer,questions.explanation,questions.material,questions.difficulty,questions.tags,questions.source_label,questions.year,questions.image_url) IS DISTINCT FROM (EXCLUDED.title,EXCLUDED.exam_type,EXCLUDED.subject,EXCLUDED.category_id,EXCLUDED.type,EXCLUDED.correct_answer,EXCLUDED.explanation,EXCLUDED.material,EXCLUDED.difficulty,EXCLUDED.tags,EXCLUDED.source_label,EXCLUDED.year,EXCLUDED.image_url) THEN now() ELSE questions.updated_at END WHERE questions.id=EXCLUDED.id AND questions.source_id=EXCLUDED.source_id',
      );
      // Options live in a separate table, but changing them invalidates the question
      // version used by saved answers and AI explanations just like changing its title.
      await client.query(
        `UPDATE questions q SET updated_at=now()
         FROM jsonb_to_recordset($1::jsonb) AS incoming(id uuid, choices jsonb)
         WHERE q.id=incoming.id AND q.source_id=$2
         AND COALESCE((SELECT jsonb_agg(jsonb_build_object('key',o.key,'text',o.text) ORDER BY o.key)
                       FROM question_options o WHERE o.question_id=q.id), '[]'::jsonb)
             IS DISTINCT FROM incoming.choices`,
        [
          JSON.stringify(
            batch.map((question) => ({
              id: question.id,
              choices: question.options
                .map(({ key, text }) => ({ key, text }))
                .sort((left, right) => left.key.localeCompare(right.key)),
            })),
          ),
          manifest.sourceId,
        ],
      );
      await client.query('DELETE FROM question_options WHERE question_id=ANY($1::uuid[])', [
        batch.map((q) => q.id),
      ]);
      const options = batch.flatMap((q) =>
        q.options.map((option) => [option.id, q.id, option.key, option.text]),
      );
      await insert(client, 'question_options', ['id', 'question_id', 'key', 'text'], options, '');
      observed.questions += batch.length;
      observed.options += options.length;
      observed.subjective += batch.filter((q) => q.type === 'subjective').length;
      observed.objective += batch.filter((q) => q.type !== 'subjective').length;
    }
    for await (const batch of batches(records(directory, 'papers.jsonl', paperSchema))) {
      batch.forEach((paper) => {
        sourceGuard(paper.sourceId, manifest.sourceId);
        if (paperIds.has(paper.id)) throw new Error('Duplicate paper UUID');
        paperIds.add(paper.id);
      });
      await insert(
        client,
        'source_papers',
        [
          'id',
          'external_key',
          'source_id',
          'title',
          'subject',
          'category',
          'year',
          'question_count',
          'materials',
          'raw',
        ],
        batch.map((p) => [
          p.id,
          p.externalKey,
          p.sourceId,
          p.title,
          p.subject,
          p.category,
          p.year,
          p.questionCount,
          JSON.stringify(p.materials),
          JSON.stringify(p.raw),
        ]),
        'ON CONFLICT (external_key) DO UPDATE SET title=EXCLUDED.title,subject=EXCLUDED.subject,category=EXCLUDED.category,year=EXCLUDED.year,question_count=EXCLUDED.question_count,materials=EXCLUDED.materials,raw=EXCLUDED.raw,updated_at=now() WHERE source_papers.id=EXCLUDED.id AND source_papers.source_id=EXCLUDED.source_id',
      );
      observed.papers += batch.length;
    }
    for await (const batch of batches(records(directory, 'paper-questions.jsonl', linkSchema))) {
      if (batch.some((link) => !paperIds.has(link.paperId) || !questionIds.has(link.questionId)))
        throw new Error('Paper question points outside this export');
      await insert(
        client,
        'source_paper_questions',
        ['id', 'paper_id', 'question_id', 'position', 'raw'],
        batch.map((p) => [p.id, p.paperId, p.questionId, p.position, JSON.stringify(p.raw)]),
        'ON CONFLICT (paper_id,position) DO UPDATE SET question_id=EXCLUDED.question_id,raw=EXCLUDED.raw WHERE source_paper_questions.id=EXCLUDED.id',
      );
      observed.paperQuestions += batch.length;
    }
    for (const key of Object.keys(observed) as (keyof typeof observed)[])
      if (observed[key] !== manifest.counts[key])
        throw new Error(`${key} input count mismatch: ${observed[key]} != ${manifest.counts[key]}`);
    const actual = (
      await client.query(
        `SELECT
      (SELECT count(*)::int FROM questions WHERE source_id=$1) AS questions,
      (SELECT count(*)::int FROM questions WHERE source_id=$1 AND type <> 'subjective') AS objective,
      (SELECT count(*)::int FROM questions WHERE source_id=$1 AND type = 'subjective') AS subjective,
      (SELECT count(*)::int FROM question_options o JOIN questions q ON q.id=o.question_id WHERE q.source_id=$1) AS options,
      (SELECT count(*)::int FROM source_papers WHERE source_id=$1) AS papers,
      (SELECT count(*)::int FROM source_paper_questions pq JOIN source_papers p ON p.id=pq.paper_id WHERE p.source_id=$1) AS "paperQuestions"`,
        [manifest.sourceId],
      )
    ).rows[0] as Record<string, number>;
    for (const [key, count] of Object.entries(actual))
      if (count !== manifest.counts[key as keyof typeof manifest.counts])
        throw new Error(`${key} database count mismatch: ${count}`);
    const inconsistent = await client.query(
      'SELECT p.id FROM source_papers p LEFT JOIN source_paper_questions pq ON pq.paper_id=p.id WHERE p.source_id=$1 GROUP BY p.id HAVING count(pq.id) <> p.question_count OR min(pq.position) <> 1 OR max(pq.position) <> p.question_count',
      [manifest.sourceId],
    );
    if (inconsistent.rowCount) throw new Error('Paper question count or ordering mismatch');
    await client.query('COMMIT');
    return { sourceId: manifest.sourceId, sourceRevision: manifest.sourceRevision, counts: observed };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--input');
  const directory = index >= 0 ? process.argv[index + 1] : undefined;
  if (!directory || !process.env.DATABASE_URL) {
    console.error(
      'Usage: DATABASE_URL=... tsx scripts/import-question-bank.ts --input /absolute/export/directory',
    );
    process.exitCode = 1;
  } else {
    importQuestionBank(resolve(directory), process.env.DATABASE_URL)
      .then((result) => console.log(JSON.stringify(result)))
      .catch((error: unknown) => {
        // PostgreSQL errors can contain source content, so print just the error message.
        console.error(
          `Import failed; transaction rolled back: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        process.exitCode = 1;
      });
  }
}
