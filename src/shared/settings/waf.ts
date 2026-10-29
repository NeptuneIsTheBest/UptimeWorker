import { HTTP_METHODS } from '../monitors/constants';
import { WAF_BYPASS_HEADER } from './constants';
import type { MonitorConfig } from '../monitors/types';
import { wafMonitorDomain } from '../monitors/validation';

// These domains are only used to generate the Cloudflare rule template.
export function wafRuleDomains(monitors: readonly MonitorConfig[]): string[] {
  return [
    ...new Set(
      monitors.flatMap((monitor) => {
        if (monitor.type !== 'http' || !monitor.wafBypassEnabled) return [];
        const domain = wafMonitorDomain(monitor.url);
        return domain ? [domain] : [];
      }),
    ),
  ].sort();
}
export function wafSkipExpression(domains: string[], token = '<YOUR_TOKEN>'): string {
  return [
    `(http.host in {${domains.map((domain) => JSON.stringify(domain)).join(' ')}})`,
    `(http.request.method in {${HTTP_METHODS.map((method) => JSON.stringify(method)).join(' ')}})`,
    `(any(http.request.headers["${WAF_BYPASS_HEADER.toLowerCase()}"][*] eq ${JSON.stringify(token)}))`,
  ].join(' and\n');
}
