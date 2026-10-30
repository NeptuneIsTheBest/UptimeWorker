import { DEFAULT_PERFORMANCE } from '../../../src/shared/settings/performance';
import { test as base, expect, type APIRequestContext } from '@playwright/test';
import type { AdminMonitor } from '../../../src/shared/monitors/types';
import type { GlobalSettings } from '../../../src/shared/settings/types';
import type { AdminEvent } from '../../../src/shared/events/types';
import type { GroupListing } from '../../../src/shared/groups/types';
import { orderItems } from '../../../src/shared/ordering';

export { expect };
export const origin = { Origin: 'http://127.0.0.1:4173' };

export async function clearMonitors(request: APIRequestContext) {
  const response = await request.get('/api/admin/monitors');
  expect(response.ok()).toBe(true);
  const { monitors } = (await response.json()) as { monitors: AdminMonitor[] };
  for (const monitor of monitors) {
    const deleted = await request.delete(`/api/admin/monitors/${monitor.id}`, { headers: origin, data: {} });
    expect(deleted.ok()).toBe(true);
  }
}

export async function createMonitor(request: APIRequestContext, changes: Record<string, unknown> = {}) {
  const response = await request.post('/api/admin/monitors', {
    headers: origin,
    data: {
      name: 'WAF 站点',
      url: 'https://example.com/',
      enabled: true,
      type: 'http',
      method: 'GET',
      wafBypassEnabled: true,
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      intervalMinutes: 5,
      timeoutSeconds: 10,
      ...changes,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as AdminMonitor;
}

export const test = base.extend<{ resetState: void }>({
  resetState: [
    async ({ request }, use) => {
      await clearMonitors(request);
      // Deleting monitors stops open automatic events, which can then be removed.
      while (true) {
        const listing = await request.get('/api/admin/events');
        expect(listing.ok()).toBe(true);
        const { events } = (await listing.json()) as { events: AdminEvent[] };
        if (!events.length) break;
        for (const event of events)
          expect(
            (
              await request.delete(`/api/admin/events/${event.id}`, {
                headers: origin,
                data: { version: event.version },
              })
            ).ok(),
          ).toBe(true);
      }
      const listing = await request.get('/api/admin/groups');
      const { groups, ungrouped } = (await listing.json()) as GroupListing;
      for (const group of groups)
        expect(
          (
            await request.delete(`/api/admin/groups/${group.id}`, {
              headers: origin,
              data: { version: group.version },
            })
          ).ok(),
        ).toBe(true);
      expect(
        (
          await request.put('/api/admin/groups/order', {
            headers: origin,
            data: { items: orderItems([ungrouped]) },
          })
        ).ok(),
      ).toBe(true);
      const response = await request.get('/api/admin/settings');
      expect(response.ok()).toBe(true);
      const current = (await response.json()) as GlobalSettings;
      // Empty tokens retain the stored value, so seed a known token to isolate each test.
      const saved = await request.patch('/api/admin/settings', {
        headers: origin,
        data: {
          version: current.version,
          pageRefreshSeconds: 30,
          performance: DEFAULT_PERFORMANCE,
          autoIncidentAfterMinutes: 5,
          wafBypassEnabled: false,
          wafBypassToken: 'e2e-fixture-token-'.repeat(4),
        },
      });
      expect(saved.ok()).toBe(true);
      await use();
    },
    { auto: true },
  ],
});
