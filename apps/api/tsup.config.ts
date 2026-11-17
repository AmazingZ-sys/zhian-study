import { defineConfig } from 'tsup';
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'db/migrate': 'src/db/migrate.ts',
    'db/seed': 'src/db/seed.ts',
    'import-question-bank': 'scripts/import-question-bank.ts',
  },
  noExternal: [/^@zhian\//],
  sourcemap: true,
  target: 'node22',
});
