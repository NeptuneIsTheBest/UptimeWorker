export interface PageRefreshSettings {
  pageRefreshSeconds: number;
}

export interface PerformanceSettings {
  workersPlan: 'free' | 'paid';
  concurrency: number;
  maxChecksPerRun: number;
  timeBudgetSeconds: number;
}

export interface GlobalSettings extends PageRefreshSettings {
  version: number;
  performance: PerformanceSettings;
  autoIncidentAfterMinutes: number;
  wafBypassEnabled: boolean;
  wafBypassTokenConfigured: boolean;
}
