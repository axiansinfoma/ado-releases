#!/usr/bin/env node
/**
 * dev-manifest.mjs - prepare the private dev extension "ado-releases-dev" from a build.
 *
 * Synopsis:
 *   node scripts/dev-manifest.mjs <X.Y.Z> [<commit>]
 *
 * Description:
 *   Writes vss-extension.dev.json and package-dev/PublishReleaseDevV0/ (a copy of the built
 *   task) so the dev extension can be installed next to the public one in the same organization:
 *   - extension id "ado-releases-dev", name "Releases (dev)", always private, Preview flag;
 *   - its own task id and name (PublishReleaseDev@0, "Publish release (dev)");
 *   - the Releases page named "Releases (dev)";
 *   - extension and task version <X.Y.Z> (the workflow uses 0.0.<run number>, which only grows).
 *   Run `npm run build` first. Package with:
 *     npx tfx-cli@0.24.2 extension create --manifest-globs vss-extension.dev.json
 *
 * Options:
 *   -h, --help   show this help
 *
 * Example:
 *   npm run build && node scripts/dev-manifest.mjs 0.0.42 "$(git rev-parse --short HEAD)"
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = 'package-dev';
const DEV_MANIFEST = 'vss-extension.dev.json';
const TASK_SRC = 'packages/task/dist/PublishReleaseV0';
const TASK_DEV = `${OUT}/PublishReleaseDevV0`;
/** Fixed task id of the dev task; must differ from the public task's id in packages/task/task.json. */
const DEV_TASK_ID = '65ecdd53-666c-4520-8ede-9e4320eb03e8';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const USAGE = `Usage: node scripts/dev-manifest.mjs <X.Y.Z> [<commit>]

Prepare vss-extension.dev.json and package-dev/ for the private dev extension "ado-releases-dev" (run "npm run build" first).
`;

/** Print an error and the usage to stderr, exit with code 2. */
function usageError(message) {
  process.stderr.write(`error: ${message}\n\n${USAGE}`);
  process.exit(2);
}

const [version, commit] = process.argv.slice(2);
if (version === '-h' || version === '--help') {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (!version || !SEMVER.test(version)) usageError('needs a version X.Y.Z');
process.chdir(root);
if (!existsSync(`${TASK_SRC}/task.json`)) usageError(`${TASK_SRC} is missing; run "npm run build" first`);

rmSync(OUT, { recursive: true, force: true });
rmSync(DEV_MANIFEST, { force: true });
mkdirSync(OUT);
cpSync(TASK_SRC, TASK_DEV, { recursive: true });

const [Major, Minor, Patch] = version.split('.').map(Number);
const task = JSON.parse(readFileSync(`${TASK_DEV}/task.json`, 'utf8'));
Object.assign(task, {
  id: DEV_TASK_ID,
  name: 'PublishReleaseDev',
  friendlyName: 'Publish release (dev)',
  instanceNameFormat: `${task.instanceNameFormat} (dev)`,
  version: { Major, Minor, Patch },
});
writeFileSync(`${TASK_DEV}/task.json`, JSON.stringify(task, null, 2) + '\n');

const manifest = JSON.parse(readFileSync('vss-extension.json', 'utf8'));
Object.assign(manifest, {
  id: 'ado-releases-dev',
  name: 'Releases (dev)',
  version,
  public: false,
  galleryFlags: ['Preview'],
  // the Marketplace limits the description to 200 characters
  description: `Development build${commit ? ` of ${commit}` : ''} of the Releases extension (GitHub-style releases for Azure Repos). Not for production use.`,
});
manifest.files = manifest.files.map((f) => (f.path === TASK_SRC ? { ...f, path: TASK_DEV } : f));
for (const c of manifest.contributions) {
  if (c.type === 'ms.vss-distributed-task.task') c.properties.name = TASK_DEV;
  if (c.type === 'ms.vss-web.hub') c.properties.name = `${c.properties.name} (dev)`;
}
writeFileSync(DEV_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`prepared ${DEV_MANIFEST} and ${OUT}/ for ado-releases-dev ${version}`);
