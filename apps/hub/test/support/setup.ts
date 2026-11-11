/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDataDir = await mkdtemp(join(tmpdir(), 'haus-hub-test-'));
process.env.HAUS_DATA_DIR = testDataDir;
// Parallel fixtures own separate listeners; the production default remains port 1883.
process.env.HAUS_MQTT_PORT = '0';
process.env.HAUS_MQTT_HOST = '127.0.0.1';

afterAll(async () => {
  await rm(testDataDir, { recursive: true, force: true });
});
