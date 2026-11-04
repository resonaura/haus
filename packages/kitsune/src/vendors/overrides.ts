/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { vendorCatalog, type VendorPreset } from './catalog/index.js';
export type DriverRoute =
  { driver: 'native' } | { driver: 'npm'; package: string; version?: string };
export function vendorRoute(
  id: string,
  overrides: Readonly<Record<string, DriverRoute>> = {},
): DriverRoute {
  const preset = vendorCatalog.find((preset) => preset.id === id);
  if (!preset) throw Error('kitsune_unknown_vendor');
  const override = overrides[id];
  if (override) return override;
  return preset.driver === 'native'
    ? { driver: 'native' }
    : { driver: 'npm', package: preset.package! };
}
/** Resolve actual plugin-provided setting keys. Never guess/write hidden storage keys. */
export function onboardingSettings(
  preset: VendorPreset,
  input: Record<string, string>,
  actual: { key: string; title?: string; type?: string; multiple?: boolean; readonly?: boolean }[],
) {
  const aliases: Record<string, string[]> = {
    ip: ['ip', 'ipAddress', 'host', 'address'],
    username: ['username', 'user'],
    password: ['password'],
    url: ['url', 'rtspUrl', 'rtspUrls'],
    refreshToken: ['refreshToken'],
  };
  return preset.fields.flatMap((field) => {
    const value = input[field.key];
    if (!value && field.required) throw Error(`kitsune_missing_field:${field.key}`);
    if (!value) return [];
    const candidates = actual.filter((setting) =>
      (aliases[field.key] ?? [field.key]).includes(setting.key),
    );
    if (candidates.length !== 1 || candidates[0].readonly)
      throw Error(`kitsune_setting_requires_review:${field.key}`);
    if (candidates[0].type && !['string', 'password'].includes(candidates[0].type))
      throw Error(`kitsune_setting_requires_review:${field.key}`);
    return [{ key: candidates[0].key, value: candidates[0].multiple ? [value] : value }];
  });
}
