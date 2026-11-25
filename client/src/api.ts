import type {
  Collection,
  CollectionSuggestion,
  ContinueItem,
  DownloadItem,
  DownloadUpdate,
  EpisodeContext,
  ImportMode,
  ImportSummary,
  Me,
  NetworkInfo,
  Preview,
  Settings,
  StorageSummary,
  SystemInfo,
  TitleDetail,
  TitleSummary,
  TitleType,
} from './types';

/** Fired when the server says this device's session is gone, so the app can show the login page. */
export const UNAUTHORIZED_EVENT = 'ytf:unauthorized';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Sends a file as-is (not JSON), for the catalog import. */
async function upload<T>(path: string, file: File): Promise<T> {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? (res.status === 413 ? 'That file is too large to be a catalog.' : `Request failed (${res.status})`));
  }
  return res.json();
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export interface ImportInput {
  url: string;
  type: TitleType;
  importAs?: 'playlist' | 'video';
  seriesMode?: 'season' | 'series';
  seriesId?: number;
  seasonNumber?: number;
  autoDownload?: boolean;
}

export interface TitlePatch {
  name?: string;
  description?: string;
  tags?: string[];
  featured?: boolean;
}

export const api = {
  titles: () => request<TitleSummary[]>('/titles'),
  title: (id: number) => request<TitleDetail>(`/titles/${id}`),
  playTarget: (id: number) => request<{ episodeId: number }>(`/titles/${id}/play`),
  preview: (url: string, importAs?: 'playlist' | 'video') =>
    send<Preview>('POST', '/titles/preview', { url, importAs }),
  importTitle: (input: ImportInput) => send<{ titleId: number; newEpisodeIds: number[] }>('POST', '/titles', input),
  refresh: (id: number) => send<{ newEpisodeIds: number[] }>('POST', `/titles/${id}/refresh`),
  updateTitle: (id: number, patch: TitlePatch) => send<TitleDetail>('PATCH', `/titles/${id}`, patch),
  deleteTitle: (id: number, keepFiles: boolean) => send<void>('DELETE', `/titles/${id}?keepFiles=${keepFiles}`),

  episode: (id: number) => request<EpisodeContext>(`/episodes/${id}`),
  streamUrl: (id: number) => `/api/episodes/${id}/stream`,
  saveProgress: (id: number, seconds: number, duration: number | null) =>
    send<void>('PUT', `/episodes/${id}/progress`, { seconds, duration }),
  continueWatching: () => request<ContinueItem[]>('/continue'),

  downloads: () => request<{ items: DownloadItem[]; live: DownloadUpdate[] }>('/downloads'),
  download: (scope: { episodeIds?: number[]; titleId?: number; seasonId?: number }) =>
    send<{ queued: number }>('POST', '/downloads', scope),
  downloadAction: (id: number, action: 'pause' | 'resume' | 'cancel') =>
    send<void>('POST', `/downloads/${id}/${action}`),
  deleteFile: (id: number) => send<void>('DELETE', `/episodes/${id}/file`),
  storage: () => request<StorageSummary>('/downloads/storage'),
  deleteFiles: (episodeIds: number[]) => send<void>('DELETE', '/downloads/files', { episodeIds }),

  settings: () => request<Settings>('/settings'),
  saveSettings: (patch: Partial<Settings>) => send<Settings>('PUT', '/settings', patch),
  system: () => request<SystemInfo>('/system'),
  updateYtDlp: () => send<{ output: string }>('POST', '/system/update-ytdlp'),

  collections: () => request<Collection[]>('/collections'),
  collectionSuggestions: () => request<CollectionSuggestion[]>('/collections/suggestions'),
  createCollection: (name: string, titleIds: number[]) => send<{ id: number }>('POST', '/collections', { name, titleIds }),
  updateCollection: (id: number, patch: { name?: string; titleIds?: number[] }) => send<Collection | null>('PUT', `/collections/${id}`, patch),
  deleteCollection: (id: number) => send<void>('DELETE', `/collections/${id}`),

  catalogExportUrl: '/api/catalog/export',
  previewCatalogImport: (file: File, mode: ImportMode) => upload<ImportSummary>(`/catalog/inspect?mode=${mode}`, file),
  importCatalog: (file: File, mode: ImportMode) => upload<ImportSummary>(`/catalog/import?mode=${mode}`, file),

  me: () => request<Me>('/auth/me'),
  login: (password: string) => send<void>('POST', '/auth/login', { password }),
  logout: () => send<void>('POST', '/auth/logout'),
  setPassword: (password: string) => send<void>('PUT', '/auth/password', { password }),
  signOutAll: () => send<void>('POST', '/auth/sign-out-all'),
  network: () => request<NetworkInfo>('/network'),
};
