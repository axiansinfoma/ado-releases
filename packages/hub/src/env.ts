import { WikiStore, type AdoClient, type GitRepository, type WikiLocation } from '@ado-releases/core';
import type { Route } from './model.js';
import type { HostContext } from './sdk.js';

/** What every view gets. */
export interface Env {
  host: HostContext;
  /** Current repository with web URL and default branch. */
  repo: GitRepository;
  wiki: WikiLocation;
  navigate: (route: Route) => void;
  /** Reload the wiki location after the settings changed. */
  reloadSettings: () => Promise<void>;
}

/** Run `fn` with a client holding a fresh token and a store for the configured wiki. */
export async function withStore<T>(env: Env, fn: (client: AdoClient, store: WikiStore) => Promise<T>): Promise<T> {
  const client = await env.host.client();
  return fn(client, new WikiStore(client, env.wiki));
}

export function defaultBranchName(repo: GitRepository): string {
  return (repo.defaultBranch ?? 'refs/heads/main').replace(/^refs\/heads\//, '');
}
