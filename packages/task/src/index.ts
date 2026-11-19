/**
 * Azure Pipelines task "Publish release".
 * Reads inputs and the job access token from the environment the agent provides
 * (INPUT_*, ENDPOINT_AUTH_SYSTEMVSSCONNECTION), so it needs no task library at runtime.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdoClient, parseTag, publishRelease, WikiStore } from '@ado-releases/core';

/** Input value as the agent passes it (INPUT_<NAME>), trimmed; undefined when empty. */
export function input(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[`INPUT_${name.replace(/[ .]/g, '_').toUpperCase()}`]?.trim();
  return value ? value : undefined;
}

/**
 * Boolean or pickList input, case-insensitive: template expressions pass booleans as "True"/"False".
 * Returns the lowercase value, `fallback` when empty; throws on a value outside `allowed`.
 */
export function choice<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
  env: NodeJS.ProcessEnv = process.env,
): T {
  const value = input(name, env)?.toLowerCase();
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`input ${name} must be one of ${allowed.join(', ')}, got "${input(name, env)}"`);
  }
  return value as T;
}

/** The job access token (System.AccessToken) from the SystemVssConnection endpoint. */
export function accessToken(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.ENDPOINT_AUTH_SYSTEMVSSCONNECTION;
  if (raw) {
    const token = (JSON.parse(raw) as { parameters?: { AccessToken?: string } }).parameters?.AccessToken;
    if (token) return token;
  }
  if (env.SYSTEM_ACCESSTOKEN) return env.SYSTEM_ACCESSTOKEN;
  throw new Error('no job access token available (SystemVssConnection)');
}

function command(cmd: string, props: Record<string, string>, value = ''): void {
  const p = Object.entries(props)
    .map(([k, v]) => `${k}=${v}`)
    .join(';');
  process.stdout.write(`##vso[${cmd}${p ? ' ' + p : ''}]${value}\n`);
}

function setOutput(name: string, value: string): void {
  command('task.setvariable', { variable: name, isOutput: 'true' }, value);
}

export async function run(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const tag = input('tag', env) ?? '';
  if (!parseTag(tag)) throw new Error(`input tag "${tag}" is not "<prefix>/v<semver>" or "v<semver>"`);
  const project = input('project', env) ?? env.SYSTEM_TEAMPROJECT ?? '';
  const repository = input('repository', env) ?? env.BUILD_REPOSITORY_NAME ?? '';
  const org = env.SYSTEM_COLLECTIONURI ?? env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI;
  if (!org) throw new Error('SYSTEM_COLLECTIONURI is not set');
  const ifExists = choice('ifExists', ['skip', 'fail', 'replace'], 'skip', env);
  const prerelease = choice('prerelease', ['auto', 'true', 'false'], 'auto', env);
  const dryRun = choice('dryRun', ['true', 'false'], 'false', env) === 'true';

  const client = new AdoClient({ organizationUrl: org, token: accessToken(env) });
  const wikiProject = input('wikiProject', env) ?? project;
  const store = new WikiStore(client, {
    project: wikiProject,
    repository: input('wiki', env), // default: the project wiki, found by name or as the hidden *.wiki repository
    branch: input('wikiBranch', env),
    root: input('root', env),
  });

  const parsed = parseTag(tag)!;
  const repo = await client.getRepository(project, repository);
  const pkg = input('package', env) ?? (parsed.prefix || repo.name);
  const existing = await store.loadPackage(repo.name, pkg);
  if (existing.some((r) => r.version === parsed.version)) {
    if (ifExists === 'skip') {
      console.log(`Release ${pkg} ${parsed.version} already exists, skipping.`);
      setOutput('releaseVersion', parsed.version);
      return;
    }
    if (ifExists === 'fail') throw new Error(`release ${pkg} ${parsed.version} already exists`);
  }

  const res = await publishRelease(client, store, {
    project,
    repository,
    tag,
    previousTag: input('previousTag', env),
    package: pkg,
    pathFilter: input('pathFilter', env),
    title: input('title', env),
    prerelease: prerelease === 'auto' ? undefined : prerelease === 'true',
    createTagOnCommit: input('createTagOnCommit', env),
    publishedBy: env.BUILD_REQUESTEDFOR,
    allowReplace: ifExists === 'replace',
    dryRun,
  });

  console.log(`Previous tag: ${res.record.previousTag ?? '(none)'}`);
  console.log(`${dryRun ? 'Planned' : 'Written'} files:\n  ${res.files.map((f) => f.path).join('\n  ')}`);
  console.log(`\n${res.record.notes}`);
  const ctx = await store.renderContext(repo.webUrl);
  const url = ctx.releasePageUrl(res.record);
  setOutput('releaseVersion', res.record.version);
  setOutput('releaseUrl', url);
  if (res.wikiCommitId) setOutput('wikiCommitId', res.wikiCommitId);

  const tmp = env.AGENT_TEMPDIRECTORY;
  if (tmp) {
    const summary = join(tmp, `release-${pkg.replace(/[^A-Za-z0-9._-]+/g, '_')}-${res.record.version}.md`);
    writeFileSync(summary, `# ${pkg} ${res.record.version}${dryRun ? ' (dry run)' : ''}\n\n[Release page](${url})\n\n${res.record.notes}`);
    command('task.uploadsummary', {}, summary);
  }
}

// Run only when executed as the task entry point (not when imported by tests).
if (process.argv[1] && /index\.(js|ts)$/.test(process.argv[1])) {
  run().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    command('task.logissue', { type: 'error' }, message);
    command('task.complete', { result: 'Failed' }, message);
    process.exitCode = 1;
  });
}
