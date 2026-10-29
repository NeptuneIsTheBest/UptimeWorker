import { errorMessage, type DisplayMessage } from '../i18n/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isPageRefreshSeconds } from '../../shared/settings/validation';
import { DEFAULT_PAGE_REFRESH_SECONDS } from '../../shared/settings/constants';
import type { PageRefreshSettings } from '../../shared/settings/types';
import { api } from '../lib/api';

export function useRemote<T extends PageRefreshSettings>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<DisplayMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [pageRefreshSeconds, setPageRefreshSeconds] = useState(DEFAULT_PAGE_REFRESH_SECONDS);
  const loadRef = useRef<(seconds?: number) => void>(() => {});
  const refresh = useCallback(() => loadRef.current(), []);
  const refreshWithSettings = useCallback(
    (settings: PageRefreshSettings) => loadRef.current(settings.pageRefreshSeconds),
    [],
  );
  useEffect(() => {
    let active = true;
    let requestId = 0;
    let seconds = DEFAULT_PAGE_REFRESH_SECONDS;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setData(null);
    setError(null);
    setLoading(true);
    setLastRefreshedAt(null);
    setPageRefreshSeconds(seconds);

    function applyInterval(value: number) {
      seconds = value;
      setPageRefreshSeconds(value);
    }
    function schedule() {
      clearTimeout(timer);
      if (active && seconds > 0 && document.visibilityState === 'visible')
        timer = setTimeout(() => void load(), seconds * 1000);
    }
    async function load() {
      clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      const id = ++requestId;
      setRefreshing(true);
      try {
        const value = await api<T>(path, { signal: controller.signal, cache: 'no-store' });
        if (active && id === requestId) {
          setData(value);
          setError(null);
          setLastRefreshedAt(Date.now());
          // An older cached response may not contain the new setting during rollout.
          applyInterval(
            isPageRefreshSeconds(value.pageRefreshSeconds)
              ? value.pageRefreshSeconds
              : DEFAULT_PAGE_REFRESH_SECONDS,
          );
        }
      } catch (err) {
        if (active && id === requestId && !(err instanceof DOMException && err.name === 'AbortError'))
          setError(errorMessage(err, 'error.network'));
      } finally {
        if (active && id === requestId) {
          setLoading(false);
          setRefreshing(false);
          schedule();
        }
      }
    }
    loadRef.current = (updatedSeconds) => {
      if (isPageRefreshSeconds(updatedSeconds)) applyInterval(updatedSeconds);
      void load();
    };
    function visibilityChanged() {
      clearTimeout(timer);
      if (document.visibilityState === 'visible' && seconds > 0) void load();
    }
    document.addEventListener('visibilitychange', visibilityChanged);
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibilityChanged);
      loadRef.current = () => {};
    };
  }, [path]);
  return {
    data,
    error,
    loading,
    refresh,
    refreshing,
    lastRefreshedAt,
    pageRefreshSeconds,
    refreshWithSettings,
  };
}
