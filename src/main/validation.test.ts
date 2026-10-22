import { describe, expect, it } from 'vitest';
import {
  normalizeServerUrl,
  validateExternalUrl,
  validatePreferences,
  validateRequest,
  validateManagement,
} from './validation';
import { matchesOAuthState } from './auth-protocol';

describe('Home Assistant address boundaries', () => {
  it('normalizes local discovery and manual addresses', () => {
    expect(normalizeServerUrl(' homeassistant.local:8123 ')).toBe(
      'http://homeassistant.local:8123',
    );
    expect(normalizeServerUrl('http://192.168.1.25:8123/')).toBe('http://192.168.1.25:8123');
    expect(normalizeServerUrl('https://my-home.ui.nabu.casa/')).toBe(
      'https://my-home.ui.nabu.casa',
    );
    expect(normalizeServerUrl('http://[::1]:8123')).toBe('http://[::1]:8123');
  });
  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://alice:secret@ha.example',
    'http://example.com',
    'https://ha.example/auth/token',
    'https://ha.example?token=secret',
    'https://ha.example/#token',
    'http://192.168.1.1.example.com:8123',
  ])('rejects unsafe or ambiguous address %s', (value) => {
    expect(() => normalizeServerUrl(value)).toThrow();
  });
});

describe('IPC command boundaries', () => {
  it('allows normal HA reads and actions', () => {
    expect(validateRequest({ type: 'get_states' })).toEqual({ type: 'get_states' });
    expect(validateRequest({ type: 'auth/current_user' })).toEqual({ type: 'auth/current_user' });
    expect(
      validateRequest({
        type: 'history/history_during_period',
        entity_ids: ['light.bed'],
        start_time: '2026-10-16T00:00:00Z',
      }),
    ).toBeTruthy();
    expect(validateRequest({ type: 'recorder/list_statistic_ids' })).toEqual({
      type: 'recorder/list_statistic_ids',
    });
    expect(
      validateRequest({
        type: 'recorder/statistics_during_period',
        start_time: '2026-10-01T00:00:00.000Z',
        statistic_ids: ['sensor.office_temperature'],
        period: 'hour',
      }),
    ).toMatchObject({ type: 'recorder/statistics_during_period' });
    expect(
      validateRequest({
        type: 'call_service',
        domain: 'light',
        service: 'turn_on',
        target: { entity_id: 'light.desk' },
      }),
    ).toBeTruthy();
  });
  it('never exposes authentication commands or caller-selected ids', () => {
    expect(() => validateRequest({ type: 'auth/long_lived_access_token' })).toThrow();
    expect(() => validateRequest({ type: 'auth', access_token: 'secret' })).toThrow();
    expect(() => validateRequest({ type: 'get_states', id: 1 })).toThrow();
    expect(() =>
      validateRequest({ type: 'supervisor/api', endpoint: '/ingress/session', method: 'post' }),
    ).toThrow();
  });
  it('permits installed add-on management without exposing arbitrary Supervisor endpoints', () => {
    expect(validateRequest({ type: 'config_entries/get' })).toBeTruthy();
    expect(
      validateRequest({ type: 'supervisor/api', endpoint: '/addons', method: 'get' }),
    ).toBeTruthy();
    expect(
      validateRequest({
        type: 'supervisor/api',
        endpoint: '/addons/core_matter_server/restart',
        method: 'post',
      }),
    ).toBeTruthy();
    expect(() =>
      validateRequest({ type: 'supervisor/api', endpoint: '/host/reboot', method: 'post' }),
    ).toThrow();
    expect(() =>
      validateRequest({
        type: 'supervisor/api',
        endpoint: '/addons/test/uninstall',
        method: 'post',
      }),
    ).toThrow();
    expect(() =>
      validateRequest({
        type: 'supervisor/api',
        endpoint: '/addons/test/stop',
        method: 'post',
        data: { options: {} },
      }),
    ).toThrow();
  });
  it('rejects preference prototype pollution', () => {
    expect(() => validatePreferences(JSON.parse('{"__proto__":{"admin":true}}'))).toThrow();
  });
  it('allows constrained integration forms and add-on text without arbitrary REST access', () => {
    expect(
      validateManagement({
        method: 'POST',
        path: 'config/config_entries/flow',
        data: { handler: 'hue' },
      }),
    ).toBeTruthy();
    expect(
      validateManagement({
        method: 'POST',
        path: 'config/config_entries/options/flow/abc123',
        data: { option: true },
      }),
    ).toBeTruthy();
    expect(
      validateManagement({ method: 'GET', path: 'hassio/addons/core_matter_server/logs' }),
    ).toBeTruthy();
    expect(
      validateManagement({ method: 'GET', path: 'diagnostics/config_entry/hue123' }),
    ).toBeTruthy();
    expect(
      validateManagement({ method: 'GET', path: 'config/script/config/kettle_warm' }),
    ).toBeTruthy();
    expect(
      validateRequest({ type: 'script/config', entity_id: 'script.kettle_warm' }),
    ).toBeTruthy();
    expect(
      validateRequest({ type: 'automation/config', entity_id: 'automation.kettle_warm' }),
    ).toBeTruthy();
    expect(
      validateManagement({
        method: 'POST',
        path: 'config/script/config/kettle_warm',
        data: { sequence: [] },
      }),
    ).toBeTruthy();
    expect(() =>
      validateManagement({ method: 'POST', path: 'diagnostics/config_entry/hue123' }),
    ).toThrow();
    for (const path of [
      'https://other.test/api',
      '//other.test/api',
      '../auth/token',
      'config/config_entries/flow/../../auth/token',
      'hassio/host/reboot',
      'auth/token',
    ])
      expect(() => validateManagement({ method: 'POST', path })).toThrow();
    expect(() =>
      validateManagement({
        method: 'GET',
        path: 'config/config_entries/flow',
        data: { secret: 'x' },
      }),
    ).toThrow();
  });
  it('allows explicit install, options validation and reversible removal requests', () => {
    expect(
      validateRequest({ type: 'supervisor/api', endpoint: '/store', method: 'get' }),
    ).toBeTruthy();
    expect(
      validateRequest({
        type: 'supervisor/api',
        endpoint: '/addons/core_example/install',
        method: 'post',
      }),
    ).toBeTruthy();
    expect(
      validateRequest({
        type: 'supervisor/api',
        endpoint: '/addons/core_example/options/validate',
        method: 'post',
        data: { options: { enabled: false } },
      }),
    ).toBeTruthy();
    expect(
      validateRequest({
        type: 'supervisor/api',
        endpoint: '/addons/core_example/uninstall',
        method: 'post',
        data: { remove_config: false },
      }),
    ).toBeTruthy();
    expect(() =>
      validateRequest({
        type: 'supervisor/api',
        endpoint: '/addons/core_example/uninstall',
        method: 'post',
        data: { remove_config: false, force: true },
      }),
    ).toThrow();
  });
  it('restricts external links to the current server and official documentation', () => {
    expect(
      validateExternalUrl(
        'http://homeassistant.local:8123/config',
        'http://homeassistant.local:8123',
      ),
    ).toContain('/config');
    expect(validateExternalUrl('https://www.home-assistant.io/help/')).toContain('/help/');
    expect(() => validateExternalUrl('https://www.home-assistant.io.evil.test/')).toThrow();
    expect(() => validateExternalUrl('file:///tmp/untrusted')).toThrow();
  });
});

describe('OAuth callback state', () => {
  it('accepts only the exact random state and handles missing or different-size values', () => {
    expect(matchesOAuthState('a-random-one-time-value', 'a-random-one-time-value')).toBe(true);
    expect(matchesOAuthState('a-random-one-time-value', 'a-random-one-time-valuE')).toBe(false);
    expect(matchesOAuthState('a-random-one-time-value', 'short')).toBe(false);
    expect(matchesOAuthState('a-random-one-time-value', null)).toBe(false);
  });
});

it('restricts related-automation searches to device and entity identifiers', () => {
  expect(
    validateRequest({
      type: 'search/related',
      item_type: 'entity',
      item_id: 'event.remote_button_1',
    }).item_id,
  ).toBe('event.remote_button_1');
  for (const data of [
    { item_type: 'integration', item_id: 'hue' },
    { item_type: 'device', item_id: '../private' },
    { item_type: 'entity', item_id: 'https://example.test' },
  ])
    expect(() => validateRequest({ type: 'search/related', ...data })).toThrow();
});
