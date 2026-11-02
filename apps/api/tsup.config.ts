import { defineConfig } from 'tsup';
export default defineConfig({ noExternal: [/^@zhian\//], sourcemap: true, target: 'node22' });
