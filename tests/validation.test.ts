import { describe, expect, it } from 'vitest';
import { isPublicHostname, parseMonitorConfig } from '../src/shared/validation';
import { httpConfig, tcpConfig } from './helpers';

describe('monitor validation', () => {
  it('accepts the supported monitor types and normalizes URLs', () => {
    expect(
      parseMonitorConfig({ ...httpConfig, url: 'https://EXAMPLE.com/health#private', name: ' 官网 ' }),
    ).toMatchObject({ name: '官网', url: 'https://example.com/health' });
    expect(parseMonitorConfig(tcpConfig)).toEqual(tcpConfig);
  });
  it.each([
    'localhost',
    'localhost.',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '172.16.0.1',
    '100.64.1.1',
    '0.0.0.0',
    '[::1]',
    '[::ffff:127.0.0.1]',
    '[fe80::1]',
    '[fd00::1]',
    'router.local',
  ])('rejects non-public host %s', (host) => {
    expect(isPublicHostname(host)).toBe(false);
    expect(() => parseMonitorConfig({ ...httpConfig, url: `http://${host}/` })).toThrow();
  });
  it.each([
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://127.1/',
    'ftp://example.com',
    'https://user:pass@example.com',
  ])('rejects unsafe or unsupported URL %s', (url) => {
    expect(() => parseMonitorConfig({ ...httpConfig, url })).toThrow();
  });
  it('supports normalized public IPv6 and rejects inline TCP ports', () => {
    const value = parseMonitorConfig({ ...tcpConfig, hostname: '[2606:4700:4700::1111]' });
    expect(value).toMatchObject({ hostname: '2606:4700:4700::1111' });
    expect(parseMonitorConfig(value)).toEqual(value);
    expect(() => parseMonitorConfig({ ...tcpConfig, hostname: 'example.com:80' })).toThrow();
    expect(() => parseMonitorConfig({ ...tcpConfig, hostname: '[2606:4700::1]:80' })).toThrow();
  });
  it.each([
    { intervalMinutes: 1 },
    { timeoutSeconds: 0 },
    { timeoutSeconds: 31 },
    { name: '' },
    { expectedStatusMin: 500, expectedStatusMax: 200 },
    { method: 'TRACE' },
  ])('rejects invalid HTTP configuration %j', (changes) => {
    expect(() => parseMonitorConfig({ ...httpConfig, ...changes })).toThrow();
  });
  it.each([0, 25, 65536, 3.2])('rejects invalid TCP port %s', (port) => {
    expect(() => parseMonitorConfig({ ...tcpConfig, port })).toThrow();
  });
});
