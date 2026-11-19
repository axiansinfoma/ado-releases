#!/usr/bin/env node
/**
 * build.mjs - bundle the "Releases" hub into dist/.
 *
 * Usage: node scripts/build.mjs [--dev] [-h|--help]
 *   --dev   no minification, inline source maps
 *
 * Writes dist/releases.{html,js,css}. One IIFE bundle (React, SDK, core, marked, DOMPurify);
 * the page is loaded in an iframe by Azure DevOps, so it must not need a module loader.
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log('Usage: node scripts/build.mjs [--dev]\nBundle the Releases hub into dist/.');
  process.exit(0);
}
const dev = process.argv.includes('--dev');

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: { releases: 'src/index.tsx' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  outdir: 'dist',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
  logLevel: 'warning',
});
copyFileSync('static/releases.html', 'dist/releases.html');
console.log('built dist/releases.{html,js,css}');
