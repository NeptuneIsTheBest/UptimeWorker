import type { DailyStat } from '../../../shared/monitors/types';
import { percent } from '../../lib/format';

export function HistoryBars({ days }: { days: DailyStat[] }) {
  return (
    <div className="history">
      <div className="history-bars" aria-label="最近 90 天每日检测成功率（UTC）">
        {days.map((day) => (
          <span
            key={day.day}
            className={`history-bar ${day.uptime === null ? 'empty' : day.uptime === 100 ? 'up' : day.uptime === 0 ? 'down' : 'partial'}`}
            title={`${day.day} UTC · ${day.total ? `${percent(day.uptime)} · ${day.successful}/${day.total} 次成功` : '暂无数据'}`}
          />
        ))}
      </div>
      <div className="history-labels">
        <span>90 天前</span>
        <span>每日可用率 · UTC</span>
        <span>今天</span>
      </div>
    </div>
  );
}
export function Legend() {
  return (
    <div className="legend">
      <span>
        <i className="legend-dot up" />
        正常
      </span>
      <span>
        <i className="legend-dot partial" />
        部分异常
      </span>
      <span>
        <i className="legend-dot down" />
        异常
      </span>
      <span>
        <i className="legend-dot empty" />
        无数据
      </span>
    </div>
  );
}
