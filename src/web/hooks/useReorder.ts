import { useEffect, useRef, useState, type DragEvent } from 'react';
import { errorMessage, message, type DisplayMessage } from '../i18n/core';

export function useReorder<T extends { id: string }>({
  items,
  disabled,
  suspend,
  save,
  scope = () => null,
}: {
  items: T[];
  disabled: boolean;
  suspend: () => () => void;
  save: (items: T[]) => Promise<void>;
  scope?: (item: T) => string | null;
}) {
  const [preview, setPreview] = useState<T[] | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: DisplayMessage; error: boolean } | null>(null);
  const release = useRef<(() => void) | null>(null);
  const dragging = useRef<T | null>(null);
  const pending = useRef(false);
  const blocked = disabled && !release.current;
  useEffect(
    () => () => {
      release.current?.();
    },
    [],
  );

  function finish() {
    dragging.current = null;
    setDragged(null);
    setTarget(null);
    release.current?.();
    release.current = null;
  }
  async function move(from: T, to: T) {
    if (pending.current || blocked || from.id === to.id || scope(from) !== scope(to)) return;
    const members = items.filter((item) => scope(item) === scope(from));
    const start = members.findIndex((item) => item.id === from.id);
    const end = members.findIndex((item) => item.id === to.id);
    if (start < 0 || end < 0) return;
    members.splice(end, 0, members.splice(start, 1)[0]);
    pending.current = true;
    release.current ??= suspend();
    setSaving(true);
    setNotice(null);
    let index = 0;
    setPreview(items.map((item) => (scope(item) === scope(from) ? members[index++] : item)));
    setDragged(null);
    setTarget(null);
    try {
      await save(members);
      setNotice({ text: message('sort.saved'), error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error, 'sort.failed'), error: true });
    } finally {
      setPreview(null);
      setSaving(false);
      pending.current = false;
      finish();
    }
  }
  function canDrop(item: T) {
    return !pending.current && dragging.current && scope(dragging.current) === scope(item);
  }
  return {
    items: preview ?? items,
    saving,
    notice,
    disabled: blocked || saving,
    move: (from: T, to: T) => void move(from, to),
    handleProps: (item: T) => ({
      draggable: !blocked && !saving,
      onDragStart: (event: DragEvent<HTMLButtonElement>) => {
        if (blocked || pending.current) {
          event.preventDefault();
          return;
        }
        release.current ??= suspend();
        dragging.current = item;
        setDragged(item.id);
        setNotice(null);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.id);
      },
      onDragEnd: () => {
        if (!pending.current) finish();
      },
    }),
    rowProps: (item: T) => ({
      'data-dragging': dragged === item.id || undefined,
      'data-drop-position':
        target === item.id && dragged !== item.id
          ? items.findIndex((entry) => entry.id === dragged) < items.indexOf(item)
            ? 'after'
            : 'before'
          : undefined,
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!canDrop(item)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setTarget(item.id);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!canDrop(item)) return;
        event.preventDefault();
        event.stopPropagation();
        const from = dragging.current!;
        if (from.id === item.id) finish();
        else void move(from, item);
      },
    }),
  };
}
