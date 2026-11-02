import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openapi } from '../src/openapi.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
mkdirSync(resolve(root, 'docs/generated'), { recursive: true });
const spec = resolve(root, 'docs/generated/openapi.json');
writeFileSync(spec, JSON.stringify(openapi, null, 2) + '\n');
const result = spawnSync(
  'pnpm',
  ['exec', 'openapi-typescript', spec, '-o', resolve(root, 'packages/api-client/src/generated.ts')],
  { cwd: root, stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const format = spawnSync('pnpm', ['exec','prettier','--write',spec,resolve(root,'packages/api-client/src/generated.ts')], {cwd:root,stdio:'inherit'});
if(format.status!==0) process.exit(format.status??1);
