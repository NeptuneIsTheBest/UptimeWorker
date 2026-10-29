export const formatTime = (time: number | null, full = false) =>
  time === null
    ? '尚未检测'
    : new Intl.DateTimeFormat('zh-CN', {
        ...(full ? ({ month: '2-digit', day: '2-digit' } as const) : {}),
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(time);
export const percent = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
export const latency = (value: number | null) => (value === null ? '—' : `${value.toLocaleString()} ms`);
