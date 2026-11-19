/**
 * Azure DevOps host integration. Uses azure-devops-extension-sdk 5 directly; the few host services
 * are declared here (same contracts as azure-devops-extension-api, which only supports SDK <= 4).
 */
import * as SDK from 'azure-devops-extension-sdk';
import { AdoClient } from '@ado-releases/core';

/** Resource area id of Git, used to find the organization URL. */
const GIT_AREA_ID = '4e080c62-fa21-4fbc-8fef-2a10a2b38049';

const SERVICE = {
  location: 'ms.vss-features.location-service',
  navigation: 'ms.vss-features.host-navigation-service',
  extensionData: 'ms.vss-features.extension-data-service',
  repository: 'ms.vss-code-web.vc-repository-service',
} as const;

interface ILocationService {
  getResourceAreaLocation(resourceAreaId: string): Promise<string>;
}

export interface IHostNavigationService {
  getQueryParams(): Promise<Record<string, string>>;
  setQueryParams(parameters: Record<string, string>): void;
  navigate(url: string): void;
  openNewWindow(url: string, features: string): void;
}

interface IVersionControlRepositoryService {
  getCurrentGitRepository(): Promise<{ id: string; name: string; project?: { id: string; name: string } } | null>;
}

export interface IExtensionDataManager {
  getValue<T>(key: string, options?: { scopeType?: string; defaultValue?: T }): Promise<T>;
  setValue<T>(key: string, value: T, options?: { scopeType?: string }): Promise<T>;
}

interface IExtensionDataService {
  getExtensionDataManager(extensionId: string, accessToken: string): Promise<IExtensionDataManager>;
}

/** Everything the hub needs from the host page. */
export interface HostContext {
  organizationUrl: string;
  project: { id: string; name: string };
  repository: { id: string; name: string } | null;
  user: { displayName: string };
  navigation: IHostNavigationService;
  /** A client with a fresh access token; tokens expire, so create one per operation. */
  client(): Promise<AdoClient>;
  /** Per-organization extension data (settings). */
  dataManager(): Promise<IExtensionDataManager>;
}

export async function initHost(): Promise<HostContext> {
  await SDK.init({ loaded: false, applyTheme: true });
  await SDK.ready();
  const web = SDK.getWebContext();
  const [location, navigation, repoService, dataService] = await Promise.all([
    SDK.getService<ILocationService>(SERVICE.location),
    SDK.getService<IHostNavigationService>(SERVICE.navigation),
    SDK.getService<IVersionControlRepositoryService>(SERVICE.repository),
    SDK.getService<IExtensionDataService>(SERVICE.extensionData),
  ]);
  const organizationUrl = (await location.getResourceAreaLocation(GIT_AREA_ID)).replace(/\/+$/, '');
  const repository = await repoService.getCurrentGitRepository();
  const extensionId = SDK.getExtensionContext().id;
  return {
    organizationUrl,
    project: { id: web.project.id, name: web.project.name },
    repository: repository ? { id: repository.id, name: repository.name } : null,
    user: { displayName: SDK.getUser().displayName },
    navigation,
    client: async () => new AdoClient({ organizationUrl, token: await SDK.getAccessToken() }),
    dataManager: async () => dataService.getExtensionDataManager(extensionId, await SDK.getAccessToken()),
  };
}

export function notifyLoaded(): void {
  void SDK.notifyLoadSucceeded();
}

export function notifyFailed(e: unknown): void {
  void SDK.notifyLoadFailed(e instanceof Error ? e : String(e));
}
