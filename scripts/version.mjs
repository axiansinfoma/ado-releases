#!/usr/bin/env node
/**
 * version.mjs - keep the extension version and the pipeline task version in one place.
 *
 * Synopsis:
 *   node scripts/version.mjs show
 *   node scripts/version.mjs set <X.Y.Z>
 *   node scripts/version.mjs check [<tag>]
 *
 * Description:
 *   The extension version (vss-extension.json) and the task version (packages/task/task.json)
 *   move together: Azure DevOps agents only download a task again when its version is higher,
 *   so every published extension version must also raise the task version.
 *   - show   print the extension and task versions
 *   - set    write X.Y.Z to vss-extension.json and task.json
 *   - check  fail unless both versions are equal and valid semver; with <tag> (e.g. v1.2.3 or
 *            refs/tags/v1.2.3) also unless they equal the tag
 *
 * Options:
 *   -h, --help   show this help
 *
 * Example:
 *   node scripts/version.mjs set 0.2.0 && node scripts/version.mjs check v0.2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = `${root}vss-extension.json`;
const TASK = `${root}packages/task/task.json`;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const USAGE = `Usage:
  node scripts/version.mjs show
  node scripts/version.mjs set <X.Y.Z>
  node scripts/version.mjs check [<tag>]

Keep vss-extension.json and packages/task/task.json on the same version.
  show   print both versions
  set    write X.Y.Z to both files
  check  fail unless both are equal (and equal <tag> without its "v"/"refs/tags/" prefix)
`;

/** Print usage to stderr and exit with code 2. */
function usageError(message) {
  process.stderr.write(`error: ${message}\n\n${USAGE}`);
  process.exit(2);
}

/** Read a JSON file. Returns the parsed object. */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Replace the first match of pattern in a file with replacement; exit 1 if there is no match. */
function replaceOnce(path, pattern, replacement) {
  const text = readFileSync(path, 'utf8');
  if (!pattern.test(text)) {
    process.stderr.write(`error: ${pattern} not found in ${path}\n`);
    process.exit(1);
  }
  writeFileSync(path, text.replace(pattern, replacement));
}

/** Current versions: { extension: "X.Y.Z", task: "X.Y.Z" }. */
function versions() {
  const t = readJson(TASK).version;
  return { extension: readJson(MANIFEST).version, task: `${t.Major}.${t.Minor}.${t.Patch}` };
}

const [command, arg] = process.argv.slice(2);
if (!command || command === '-h' || command === '--help') {
  process.stdout.write(USAGE);
  process.exit(command ? 0 : 2);
}

if (command === 'show') {
  const v = versions();
  console.log(`extension ${v.extension}\ntask      ${v.task}`);
} else if (command === 'set') {
  if (!arg || !SEMVER.test(arg)) usageError('set needs a version X.Y.Z (no pre-release; tasks only support numbers)');
  const [Major, Minor, Patch] = arg.split('.').map(Number);
  // Replace only the numbers, so the files keep their hand-written formatting.
  replaceOnce(MANIFEST, /("version"\s*:\s*")[^"]*(")/, `$1${arg}$2`);
  replaceOnce(TASK, /("Major"\s*:\s*)\d+/, `$1${Major}`);
  replaceOnce(TASK, /("Minor"\s*:\s*)\d+/, `$1${Minor}`);
  replaceOnce(TASK, /("Patch"\s*:\s*)\d+/, `$1${Patch}`);
  const v = versions();
  if (v.extension !== arg || v.task !== arg) usageError(`could not set the version (now extension ${v.extension}, task ${v.task})`);
  console.log(`set extension and task version to ${arg}`);
} else if (command === 'check') {
  const v = versions();
  const errors = [];
  if (!SEMVER.test(v.extension)) errors.push(`extension version ${v.extension} is not X.Y.Z`);
  if (v.extension !== v.task) errors.push(`extension version ${v.extension} != task version ${v.task}`);
  if (arg) {
    const tag = arg.replace(/^refs\/tags\//, '').replace(/^v/, '');
    if (tag !== v.extension) errors.push(`tag ${arg} != extension version ${v.extension}`);
  }
  if (errors.length) {
    for (const e of errors) console.log(`::error::${e}`);
    process.exit(1);
  }
  console.log(`versions OK: ${v.extension}${arg ? ` (tag ${arg})` : ''}`);
} else {
  usageError(`unknown command ${command}`);
}
