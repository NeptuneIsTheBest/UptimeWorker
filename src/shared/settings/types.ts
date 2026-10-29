export interface PageRefreshSettings {
  pageRefreshSeconds: number;
}

export interface GlobalSettings extends PageRefreshSettings {
  version: number;
  autoIncidentAfterMinutes: number;
  wafBypassEnabled: boolean;
  wafBypassTokenConfigured: boolean;
}
