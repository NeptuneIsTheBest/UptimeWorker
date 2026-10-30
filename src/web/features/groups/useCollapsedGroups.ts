import { useEffect, useState } from 'react';

function readCollapsed(key: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100)
        : [],
    );
  } catch {
    return new Set();
  }
}

export function useCollapsedGroups(scope: 'public' | 'admin') {
  const key = `uptimeworker:collapsed-groups:${scope}`;
  const [collapsed, setCollapsed] = useState(() => readCollapsed(key));
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify([...collapsed]));
    } catch {
      // Keep the preference in memory if browser storage is unavailable.
    }
  }, [key, collapsed]);

  return {
    isCollapsed: (id: string) => collapsed.has(id),
    toggle: (id: string) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
  };
}
