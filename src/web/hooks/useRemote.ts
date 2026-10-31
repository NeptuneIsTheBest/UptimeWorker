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
  const [locked, setLocked] = useState(false);
  const suspendRef = useRef<() => () => void>(() => () => {});
  const suspend = useCallback(() => suspendRef.current(), []);
  const updateData = useCallback((update: (current: T) => T) => {
    setData((current) => (current ? update(current) : current));
  }, []);
  const loadRef = useRef<(seconds?: number) => void>(() => {});
  const refresh = useCallback(() => loadRef.current(), []);
  const refreshWithSettings = useCallback(
    (settings: PageRefreshSettings) => loadRef.current(settings.pageRefreshSeconds),
    [],
  );
  useEffect(() => {
    let active = true;
    let requestId = 0;
    let locks = 0;
    let seconds = DEFAULT_PAGE_REFRESH_SECONDS;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setData(null);
    setError(null);
    setLoading(true);
    setLocked(false);
    setLastRefreshedAt(null);
    setPageRefreshSeconds(seconds);

    function applyInterval(value: number) {
      seconds = value;
      setPageRefreshSeconds(value);
    }
    function schedule() {
      clearTimeout(timer);
      if (active && !locks && seconds > 0 && document.visibilityState === 'visible')
        timer = setTimeout(() => void load(), seconds * 1000);
    }
    async function load() {
      if (!active || locks) return;
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
          applyInterval(value.pageRefreshSeconds);
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
    suspendRef.current = () => {
      locks++;
      requestId++;
      clearTimeout(timer);
      controller?.abort();
      setRefreshing(false);
      setLocked(true);
      let released = false;
      return () => {
        if (released || !active) return;
        released = true;
        if (--locks === 0) {
          setLocked(false);
          void load();
        }
      };
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
      suspendRef.current = () => () => {};
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
    locked,
    suspend,
    updateData,
  };
}
