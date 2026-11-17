/** Opt-in PostgreSQL regression; requires a migrated, dedicated zhian_import_test database. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { importQuestionBank } from './import-question-bank.js';

type Row = Record<string, unknown>;
type Question = Row & {
  id: string;
  title: string;
  type: string;
  options: { id: string; key: string; text: string }[];
};
type Paper = Row & { id: string; title: string; questionCount: number };
type Link = Row & { id: string; paperId: string; questionId: string; position: number };
type Manifest = Row & {
  counts: Record<string, number>;
  files: Record<string, { bytes: number; sha256: string }>;
};

async function first<T>(file: string, predicate: (record: T) => boolean): Promise<T> {
  const stream = createReadStream(file);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as T;
      if (predicate(record)) return record;
    }
    throw new Error(`No matching record found in ${file}`);
  } finally {
    lines.close();
    stream.destroy();
  }
}

async function packageFixture(directory: string, manifest: Manifest, records: Record<string, Row[]>) {
  await mkdir(directory, { recursive: true });
  const copy = structuredClone(manifest);
  copy.files = {};
  for (const [name, rows] of Object.entries(records)) {
    const bytes = Buffer.from(rows.map((row) => JSON.stringify(row) + '\n').join(''));
    await writeFile(resolve(directory, name), bytes);
    copy.files[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(copy, null, 2) + '\n');
}

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = resolve(repository, '.artifacts/question-bank/importer-regression');
const source = resolve(repository, 'data/question-bank');
const connectionString = process.env.QUESTION_BANK_REGRESSION_DATABASE_URL;
if (!connectionString || new URL(connectionString).pathname !== '/zhian_import_test') {
  throw new Error('Set QUESTION_BANK_REGRESSION_DATABASE_URL to the dedicated zhian_import_test database');
}
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
try {
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'zhian_import_test');
  const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8')) as Manifest;
  const categories = (await readFile(resolve(source, 'categories.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Row);
  const question = await first<Question>(
    resolve(source, 'questions.jsonl'),
    (row) => row.type !== 'subjective',
  );
  const link = await first<Link>(
    resolve(source, 'paper-questions.jsonl'),
    (row) => row.questionId === question.id,
  );
  const paper = await first<Paper>(resolve(source, 'papers.jsonl'), (row) => row.id === link.paperId);
  paper.questionCount = 1;
  link.position = 1;
  manifest.counts = {
    questions: 1,
    objective: 1,
    subjective: 0,
    options: question.options.length,
    papers: 1,
    paperQuestions: 1,
    categories: categories.length,
  };
  const baseline = resolve(output, 'baseline');
  const baselineRecords = {
    'categories.jsonl': categories,
    'questions.jsonl': [question],
    'papers.jsonl': [paper],
    'paper-questions.jsonl': [link],
  };
  await packageFixture(baseline, manifest, baselineRecords);
  const firstImport = await importQuestionBank(baseline, connectionString);

  async function state() {
    const selectedQuestion = (
      await pool.query(
        `SELECT q.id,q.title,q.updated_at,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('key',o.key,'text',o.text) ORDER BY o.key)
      FROM question_options o WHERE o.question_id=q.id), '[]'::jsonb) AS options
      FROM questions q WHERE q.id=$1`,
        [question.id],
      )
    ).rows[0];
    return {
      question: selectedQuestion,
      paper: (await pool.query('SELECT id,title,question_count FROM source_papers WHERE id=$1', [paper.id]))
        .rows[0],
      category: (await pool.query('SELECT id,name FROM question_categories WHERE id=$1', [categories[0]?.id]))
        .rows[0],
      source: (
        await pool.query('SELECT id,version,fetched_at FROM content_sources WHERE id=$1', [manifest.sourceId])
      ).rows[0],
      counts: (
        await pool.query(`SELECT (SELECT count(*)::int FROM questions) AS questions,
        (SELECT count(*)::int FROM question_options) AS options,
        (SELECT count(*)::int FROM source_papers) AS papers,
        (SELECT count(*)::int FROM source_paper_questions) AS links,
        (SELECT count(*)::int FROM question_categories) AS categories`)
      ).rows[0],
    };
  }

  const initialState = await state();
  await importQuestionBank(baseline, connectionString);
  const repeatState = await state();
  assert.deepEqual(
    repeatState,
    initialState,
    'Identical import must preserve question version and stored content',
  );

  const changedQuestion = structuredClone(question);
  assert.ok(changedQuestion.options[0]);
  changedQuestion.options[0].text += '\n（隔离回归：仅修改选项）';
  const changed = resolve(output, 'options-changed');
  await packageFixture(changed, manifest, { ...baselineRecords, 'questions.jsonl': [changedQuestion] });
  await importQuestionBank(changed, connectionString);
  const changedState = await state();
  assert.equal(changedState.question.title, initialState.question.title);
  assert.ok(
    changedState.question.updated_at.getTime() > initialState.question.updated_at.getTime(),
    'Options-only changes must advance question version',
  );
  assert.equal(changedState.question.options[0].text, changedQuestion.options[0].text);
  await importQuestionBank(changed, connectionString);
  assert.deepEqual(await state(), changedState, 'Repeating changed package must preserve its version');

  // Valid SHA-256 and valid JSON deliberately pass the preflight. The last-stage
  // bad relationship must roll back earlier question/options/category/paper writes.
  const corruptQuestion = structuredClone(changedQuestion);
  corruptQuestion.title += '\nROLLBACK_MUST_NOT_PERSIST';
  corruptQuestion.options[0]!.text += '\nROLLBACK_MUST_NOT_PERSIST';
  const corruptCategories = structuredClone(categories);
  corruptCategories[0]!.name += ' ROLLBACK_MUST_NOT_PERSIST';
  const malformed = resolve(output, 'malformed-record');
  await packageFixture(
    malformed,
    { ...manifest, sourceRevision: 'ROLLBACK_MUST_NOT_PERSIST' },
    {
      'categories.jsonl': corruptCategories,
      'questions.jsonl': [corruptQuestion],
      'papers.jsonl': [{ ...paper, title: paper.title + ' ROLLBACK_MUST_NOT_PERSIST' }],
      'paper-questions.jsonl': [{ ...link, questionId: randomUUID() }],
    },
  );
  let rollbackError = '';
  try {
    await importQuestionBank(malformed, connectionString);
  } catch (error) {
    rollbackError = error instanceof Error ? error.message : String(error);
  }
  assert.match(rollbackError, /Paper question points outside this export/);
  const afterRollback = await state();
  assert.deepEqual(afterRollback, changedState, 'Failed import must roll back all earlier writes');
  const report = {
    passed: true,
    database: 'zhian_import_test',
    completedAt: new Date().toISOString(),
    sourceQuestionId: question.id,
    sourcePaperId: paper.id,
    sourceRevision: manifest.sourceRevision,
    firstImport,
    checks: {
      identicalImportPreservedVersion: true,
      optionsOnlyChangeAdvancedVersion: true,
      repeatChangedImportPreservedVersion: true,
      malformedRecordRolledBackAllWrites: true,
    },
    timestamps: {
      baseline: initialState.question.updated_at,
      identical: repeatState.question.updated_at,
      optionsChanged: changedState.question.updated_at,
      afterRollback: afterRollback.question.updated_at,
    },
    rollbackError,
    finalCounts: afterRollback.counts,
  };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await pool.end();
}
