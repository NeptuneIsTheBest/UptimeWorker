import type { PublicMonitor } from '../../../src/shared/monitors/types';

export function sampleMonitor(index: number, status: PublicMonitor['status'] = 'up'): PublicMonitor {
  const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  return {
    id: `sample-${index}`,
    name: ['官方网站', 'API 服务', '数据库连接', '文件存储服务'][index],
    type: index === 2 ? 'tcp' : 'http',
    status,
    intervalMinutes: 5,
    lastCheckedAt: status === 'stale' ? Date.now() - 1_200_000 : Date.now() - 120_000,
    latencyMs: [124, 86, 32, 168][index],
    uptime30d: index === 1 ? 99.97 : 100,
    days: Array.from({ length: 90 }, (_, day) => ({
      day: new Date(today - (89 - day) * 86_400_000).toISOString().slice(0, 10),
      total: day < 10 ? 0 : 288,
      successful: day < 10 ? 0 : index === 1 && day === 80 ? 285 : 288,
      uptime: day < 10 ? null : index === 1 && day === 80 ? (285 / 288) * 100 : 100,
    })),
  };
}
