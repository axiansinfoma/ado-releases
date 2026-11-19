import { latestRelease, type ReleaseRecord, type RenderContext } from '@ado-releases/core';
import { useEffect, useState } from 'react';
import { withStore, type Env } from '../env.js';
import { describeError, mergeReleases } from '../model.js';
import { ReleaseCard } from './ReleaseCard.js';

interface Loaded {
  byPackage: Record<string, ReleaseRecord[]>;
  ctx: RenderContext;
}

/** All releases of the repository, newest first, filterable by package. */
export function ReleaseList({ env, packageFilter }: { env: Env; packageFilter?: string }) {
  const [loaded, setLoaded] = useState<Loaded>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    withStore(env, async (_client, store) => {
      const packages = await store.listPackages(env.repo.name);
      const entries = await Promise.all(
        packages.map(async (p) => [p.package, await store.loadPackage(env.repo.name, p.package)] as const),
      );
      return { byPackage: Object.fromEntries(entries), ctx: await store.renderContext(env.repo.webUrl) };
    })
      .then((l) => !cancelled && setLoaded(l))
      .catch((e: unknown) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [env]);

  const toolbar = (
    <div className="toolbar">
      <h1>Releases</h1>
      {loaded && Object.keys(loaded.byPackage).length > 1 && (
        <select
          aria-label="Package"
          value={packageFilter ?? ''}
          onChange={(e) => env.navigate(e.target.value ? { view: 'list', package: e.target.value } : { view: 'list' })}
        >
          <option value="">All packages</option>
          {Object.keys(loaded.byPackage)
            .sort()
            .map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
        </select>
      )}
      <span className="spacer" />
      <button className="secondary" onClick={() => env.navigate({ view: 'settings' })}>
        Settings
      </button>
      <button className="primary" onClick={() => env.navigate({ view: 'new', package: packageFilter })}>
        Draft a new release
      </button>
    </div>
  );

  if (error) return (<>{toolbar}<div className="error">{error}</div></>);
  if (!loaded) return (<>{toolbar}<div className="muted">Loading releases…</div></>);

  const releases = mergeReleases(loaded.byPackage, packageFilter);
  const multi = Object.keys(loaded.byPackage).length > 1;
  const latestByPackage = new Map(
    Object.entries(loaded.byPackage).map(([pkg, records]) => [pkg, latestRelease(records)?.version]),
  );
  return (
    <>
      {toolbar}
      {releases.length === 0 ? (
        <div className="empty">
          <h2>There aren't any releases here yet</h2>
          <p>
            A release turns a tag into a page with release notes from the pull requests merged since the previous tag.
            Releases are stored in the wiki <b>{env.wiki.repository}</b> under <b>{env.wiki.root}</b>, together with a{' '}
            <code>releases.json</code> per package that Renovate can read.
          </p>
          <p>Create one here, or let a pipeline publish them with the <code>PublishRelease@0</code> task.</p>
        </div>
      ) : (
        releases.map((r) => (
          <ReleaseCard
            key={`${r.package}@${r.version}`}
            record={r}
            repo={env.repo}
            isLatest={latestByPackage.get(r.package) === r.version}
            wikiUrl={loaded.ctx.releasePageUrl(r)}
            showPackage={multi}
            onOpen={() => env.navigate({ view: 'release', package: r.package, version: r.version })}
          />
        ))
      )}
    </>
  );
}
