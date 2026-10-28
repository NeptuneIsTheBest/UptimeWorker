import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new ApiError('登录可能已过期，请重新打开管理后台登录。', 401);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error || '请求失败，请稍后重试。', response.status);
  return data;
}
export function useRemote<T>(path: string, refreshMs = 60_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    let controller: AbortController;
    async function load() {
      controller?.abort();
      controller = new AbortController();
      try {
        const value = await api<T>(path, { signal: controller.signal });
        if (active) {
          setData(value);
          setError(null);
        }
      } catch (err) {
        if (active && !(err instanceof DOMException && err.name === 'AbortError'))
          setError(err instanceof Error ? err.message : '网络连接失败');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, refreshMs);
    return () => {
      active = false;
      clearInterval(timer);
      controller?.abort();
    };
  }, [path, revision, refreshMs]);
  return { data, error, loading, refresh };
}
