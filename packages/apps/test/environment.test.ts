/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import type { AppManifest } from '../src/manifest.js';
import { buildAppEnvironment } from '../src/environment.js';

const manifest: AppManifest = {
  id: 'test-app',
  name: 'Test App',
  version: '1.0.0',
  image: 'test-app:latest',
  architectures: ['amd64'],
  env: ['FLAG', 'VALUE=source', 'SUPERVISOR_TOKEN=untrusted'],
};

describe('App environment construction', () => {
  it('preserves declared variables and gives Hub runtime values exclusive ownership', () => {
    expect(
      buildAppEnvironment(manifest, {
        SUPERVISOR_API: 'http://127.0.0.1:8790/api/supervisor',
        SUPERVISOR_TOKEN: 'hub-token',
      }),
    ).toEqual([
      'FLAG',
      'VALUE=source',
      'SUPERVISOR_API=http://127.0.0.1:8790/api/supervisor',
      'SUPERVISOR_TOKEN=hub-token',
    ]);
  });

  it('rejects an App reserving Supervisor credentials without Hub injection', () => {
    expect(() => buildAppEnvironment(manifest)).toThrow('reserved_app_environment_variable');
  });
});
