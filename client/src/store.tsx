import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { ContinueItem, DownloadUpdate, TitleSummary } from './types';

interface CatalogState {
  titles: TitleSummary[];
  continueItems: ContinueItem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Bumped whenever the catalog changes, so open detail views can refetch. */
  version: number;
}

interface DownloadsState {
  live: Record<number, DownloadUpdate>;
}

const CatalogContext = createContext<CatalogState | null>(null);
const DownloadsContext = createContext<DownloadsState>({ live: {} });

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [titles, setTitles] = useState<TitleSummary[]>([]);
  const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [live, setLive] = useState<Record<number, DownloadUpdate>>({});
  const reloadTimer = useRef<number>();

  const reload = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([api.titles(), api.continueWatching()]);
      setTitles(t);
      setContinueItems(c);
      setError(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // One SSE connection for the whole app; finished downloads refresh the catalog.
  useEffect(() => {
    const source = new EventSource('/api/downloads/events');
    source.onmessage = (e) => {
      const update = JSON.parse(e.data) as DownloadUpdate;
      setLive((prev) => ({ ...prev, [update.episodeId]: update }));
      if (['done', 'error', 'none'].includes(update.status)) {
        window.clearTimeout(reloadTimer.current);
        reloadTimer.current = window.setTimeout(() => void reload(), 800);
      }
    };
    return () => source.close();
  }, [reload]);

  return (
    <CatalogContext.Provider value={{ titles, continueItems, loading, error, reload, version }}>
      <DownloadsContext.Provider value={{ live }}>{children}</DownloadsContext.Provider>
    </CatalogContext.Provider>
  );
}

export function useCatalog(): CatalogState {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used inside AppStateProvider');
  return ctx;
}

export const useLiveDownloads = () => useContext(DownloadsContext).live;
