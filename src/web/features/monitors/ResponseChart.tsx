import { useEffect, useRef, useState } from 'react';
import type { ProbeResult } from '../../../shared/monitors/types';
import { Empty } from '../../components/feedback';
import { formatTime } from '../../lib/format';

export function ResponseChart({
  checks,
  now,
  intervalMinutes,
}: {
  checks: ProbeResult[];
  now: number;
  intervalMinutes: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const hasData = checks.length > 0;
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [hasData]);
  if (!checks.length)
    return (
      <Empty title="还没有响应时间数据" icon="pulse">
        定时检测完成后，这里将展示最近 24 小时的响应趋势。
      </Empty>
    );
  const w = width,
    h = 210,
    x0 = 48,
    right = 18,
    y0 = 18,
    bottom = 30;
  const max = Math.max(100, Math.ceil(Math.max(...checks.map((c) => c.latencyMs)) / 100) * 100);
  const since = now - 86_400_000;
  const x = (time: number) => x0 + Math.max(0, Math.min(1, (time - since) / 86_400_000)) * (w - x0 - right);
  const y = (ms: number) => y0 + (1 - ms / max) * (h - y0 - bottom);
  let d = '';
  checks.forEach((c, index) => {
    const previous = checks[index - 1];
    d += `${!previous || c.checkedAt - previous.checkedAt > intervalMinutes * 120_000 ? 'M' : 'L'} ${x(c.checkedAt)} ${y(c.latencyMs)} `;
  });
  return (
    <div className="chart-wrap" ref={container}>
      <svg
        className="response-chart"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="最近 24 小时响应时间折线图，红点表示检测失败"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((n) => (
          <g key={n}>
            <line
              x1={x0}
              x2={w - right}
              y1={y(n * max)}
              y2={y(n * max)}
              stroke="var(--line)"
              strokeDasharray="3 5"
            />
            <text x={x0 - 12} y={y(n * max) + 4} textAnchor="end">
              {Math.round(n * max)}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--green)" strokeWidth="2" strokeLinejoin="round" />
        {checks
          .filter((c) => !c.ok || checks.length === 1)
          .map((c) => (
            <circle
              key={c.checkedAt}
              cx={x(c.checkedAt)}
              cy={y(c.latencyMs)}
              r="3"
              fill={c.ok ? 'var(--green)' : 'var(--red)'}
            >
              <title>
                {formatTime(c.checkedAt)} · {c.ok ? '检测成功' : '检测失败'}
              </title>
            </circle>
          ))}
        {(w < 500 ? [0, 12, 24] : [0, 6, 12, 18, 24]).map((hours) => (
          <text
            key={hours}
            x={x(since + hours * 3_600_000)}
            y={h - 4}
            textAnchor={hours === 0 ? 'start' : hours === 24 ? 'end' : 'middle'}
          >
            {hours === 24 ? '现在' : `${24 - hours} 小时前`}
          </text>
        ))}
      </svg>
    </div>
  );
}
