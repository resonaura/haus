/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { AppCatalog, assessAppPermissions, validateAppManifest } from '../src/index.js';

describe('Govee Catalog Manifests', () => {
  it('registers valid govee hybrid and homebridge-govee catalog entries with options and secrets', () => {
    const catalog = AppCatalog.createDefaultCatalog();

    const hybrid = catalog.get('govee');
    expect(hybrid).toBeDefined();
    expect(hybrid?.runtimeType).toBe('homebridge');
    expect(hybrid?.manifest.options?.map((o) => o.name)).toEqual([
      'username',
      'hybridSplit',
      'bleDisable',
      'awsDisable',
      'lanDisable',
    ]);
    expect(hybrid?.manifest.options?.find((o) => o.name === 'hybridSplit')?.default).toBe(true);
    expect(hybrid?.manifest.secrets?.map((s) => s.name)).toEqual(['password', 'code', 'apiKey']);

    const hb = catalog.get('homebridge-govee');
    expect(hb).toBeDefined();
    expect(hb?.runtimeType).toBe('homebridge');
    expect(hb?.manifest.options?.map((o) => o.name)).toEqual([
      'username',
      'hybridSplit',
      'bleDisable',
      'awsDisable',
      'lanDisable',
    ]);
    expect(hb?.manifest.secrets?.map((s) => s.name)).toEqual(['password', 'code', 'apiKey']);

    for (const entry of [hybrid!, hb!]) {
      const validation = validateAppManifest(entry.manifest);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);

      const permissions = assessAppPermissions(entry.manifest, []);
      expect(permissions.allowed).toBe(true);
      expect(permissions.missingPermissions).toEqual([]);
    }
  });
});
