import type { GitRepository, WikiLocation } from '@ado-releases/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Env } from './env.js';
import { describeError, parseRoute, routeParams, type Route } from './model.js';
import { initHost, notifyFailed, notifyLoaded, type HostContext } from './sdk.js';
import { loadSettings, resolveWikiLocation } from './settings.js';
import { DraftRelease } from './views/DraftRelease.js';
import { EditRelease } from './views/EditRelease.js';
import { ReleaseList } from './views/ReleaseList.js';
import { ReleaseView } from './views/ReleaseView.js';
import { SettingsView } from './views/SettingsView.js';

interface Boot {
  host: HostContext;
  repo: GitRepository;
}

export function App() {
  const [boot, setBoot] = useState<Boot>();
  const [wiki, setWiki] = useState<WikiLocation>();
  const [route, setRoute] = useState<Route>({ view: 'list' });
  const [error, setError] = useState<string>();

  useEffect(() => {
    (async () => {
      const host = await initHost();
      if (!host.repository) throw new Error('Select a Git repository to see its releases.');
      const client = await host.client();
      const repo = await client.getRepository(host.project.name, host.repository.id);
      const settings = await loadSettings(await host.dataManager(), host.project.id);
      setWiki(resolveWikiLocation(host.project.name, settings));
      setRoute(parseRoute(await host.navigation.getQueryParams()));
      setBoot({ host, repo });
      notifyLoaded();
    })().catch((e: unknown) => {
      setError(describeError(e));
      notifyFailed(e);
    });
  }, []);

  const navigate = useCallback(
    (next: Route) => {
      setRoute(next);
      boot?.host.navigation.setQueryParams(routeParams(next));
    },
    [boot],
  );

  const reloadSettings = useCallback(async () => {
    if (!boot) return;
    setWiki(resolveWikiLocation(boot.host.project.name, await loadSettings(await boot.host.dataManager(), boot.host.project.id)));
  }, [boot]);

  const env: Env | undefined = useMemo(
    () => (boot && wiki ? { host: boot.host, repo: boot.repo, wiki, navigate, reloadSettings } : undefined),
    [boot, wiki, navigate, reloadSettings],
  );

  if (error) return <main><div className="error">{error}</div></main>;
  if (!env) return <main><div className="muted">Loading…</div></main>;

  return (
    <main>
      {route.view === 'list' && <ReleaseList env={env} packageFilter={route.package} />}
      {route.view === 'new' && <DraftRelease env={env} initialPackage={route.package} initialTag={route.tag} />}
      {route.view === 'release' && <ReleaseView env={env} pkg={route.package} version={route.version} />}
      {route.view === 'edit' && <EditRelease env={env} pkg={route.package} version={route.version} />}
      {route.view === 'settings' && <SettingsView env={env} />}
    </main>
  );
}
