export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  SITE_NAME?: string;
  DEV_ACCESS_BYPASS?: string;
}
export interface Identity {
  email: string;
}
export type AppEnv = { Bindings: Env; Variables: { identity: Identity } };
