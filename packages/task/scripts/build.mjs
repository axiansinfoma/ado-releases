#!/usr/bin/env node
/**
 * build.mjs - bundle the "Publish release" task into dist/PublishReleaseV0.
 *
 * Usage: node scripts/build.mjs [-h|--help]
 *
 * Writes dist/PublishReleaseV0/{index.js,task.json,package.json}. The bundle is CommonJS
 * (agents run "node index.js"); the extra package.json keeps Node from treating it as ESM.
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log('Usage: node scripts/build.mjs\nBundle the task into dist/PublishReleaseV0.');
  process.exit(0);
}

const out = 'dist/PublishReleaseV0';
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: `${out}/index.js`,
  legalComments: 'none',
});
copyFileSync('task.json', `${out}/task.json`);
copyFileSync('icon.png', `${out}/icon.png`); // shown in the task assistant and task list
writeFileSync(`${out}/package.json`, '{ "type": "commonjs" }\n');
console.log(`built ${out}`);
