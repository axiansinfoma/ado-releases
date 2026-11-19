import { latestRelease, type ReleaseRecord, type RenderContext } from '@ado-releases/core';
import { useEffect, useState } from 'react';
import { withStore, type Env } from '../env.js';
import { describeError } from '../model.js';
import { ReleaseCard } from './ReleaseCard.js';

/** One release (deep link ?view=release&package=…&version=…) with Edit and Delete. */
export function ReleaseView({ env, pkg, version }: { env: Env; pkg: string; version: string }) {
  const [state, setState] = useState<{ records: ReleaseRecord[]; ctx: RenderContext }>();
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    withStore(env, async (_c, store) => ({
      records: await store.loadPackage(env.repo.name, pkg),
      ctx: await store.renderContext(env.repo.webUrl),
    }))
      .then(setState)
      .catch((e: unknown) => setError(describeError(e)));
  }, [env, pkg, version]);

  const back = (
    <div className="toolbar">
      <button className="link" onClick={() => env.navigate({ view: 'list' })}>
        ← Releases
      </button>
    </div>
  );
  if (error && !state) return (<>{back}<div className="error">{error}</div></>);
  if (!state) return (<>{back}<div className="muted">Loading…</div></>);
  const record = state.records.find((r) => r.version === version);
  if (!record) return (<>{back}<div className="error">Release {pkg} {version} not found.</div></>);

  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await withStore(env, (_c, store) => store.remove(env.repo.name, pkg, version, env.repo.webUrl));
      env.navigate({ view: 'list' });
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <>
      {back}
      <ReleaseCard
        record={record}
        repo={env.repo}
        isLatest={latestRelease(state.records)?.version === record.version}
        wikiUrl={state.ctx.releasePageUrl(record)}
        showPackage={record.package !== env.repo.name}
      >
        <div className="actions">
          <button className="secondary" disabled={busy} onClick={() => env.navigate({ view: 'edit', package: pkg, version })}>
            Edit
          </button>
          {!confirmDelete ? (
            <button className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          ) : (
            <span className="confirm">
              Delete release {record.version} from the wiki? The tag {record.tag} stays.
              <button className="danger" disabled={busy} onClick={() => void remove()}>
                {busy ? 'Deleting…' : 'Delete release'}
              </button>
              <button className="secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </span>
          )}
        </div>
        {error && <div className="error">{error}</div>}
      </ReleaseCard>
    </>
  );
}
