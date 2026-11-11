import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readPageState, readScrollPosition, saveScrollPosition, writePageState } from '../lib/navigation';

export function usePageState<T>(key: string, initial: T, valid: (value: unknown) => value is T) {
  const [value, setValue] = useState(() => readPageState(key, valid, initial));
  useLayoutEffect(() => writePageState({ [key]: value }), [key, value]);
  return [value, setValue] as const;
}

export function usePageScroll(ready: boolean) {
  const [saved] = useState(readScrollPosition);
  const restored = useRef(false);
  const readyRef = useRef(ready);
  useLayoutEffect(() => {
    readyRef.current = ready;
    if (!ready || !saved || restored.current) return;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
      restored.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, saved]);
  useEffect(() => {
    function save() {
      // Leaving during loading must not replace the original position with the loading screen's top.
      if (!saved || restored.current) saveScrollPosition();
    }
    function show(event: PageTransitionEvent) {
      if (!event.persisted || !readyRef.current) return;
      const position = readScrollPosition();
      if (position) window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
    }
    // Reload snapshots history state before pagehide, so save before unloading too.
    window.addEventListener('beforeunload', save);
    window.addEventListener('pagehide', save);
    window.addEventListener('pageshow', show);
    return () => {
      window.removeEventListener('beforeunload', save);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('pageshow', show);
    };
  }, [saved]);
}
