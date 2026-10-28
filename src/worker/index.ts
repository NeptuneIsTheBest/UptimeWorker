import { connect } from 'cloudflare:sockets';
import { createApp } from './app';
import { createProbe } from './probes';
import { runScheduled } from './scheduler';
import type { Env } from './types';

const probe = createProbe({ fetch: globalThis.fetch.bind(globalThis), connect });
const app = createApp(probe);
export default {
  fetch: app.fetch,
  async scheduled(controller, env) {
    await runScheduled(env, controller.scheduledTime, probe);
  },
} satisfies ExportedHandler<Env>;
