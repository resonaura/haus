/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'vitest';
import { remoteTarget } from './support/remote.js';
import { exerciseProtocol } from './support/protocol.js';
import { required } from '../nvr/support/values.js';
const configured = remoteTarget(process.env);

test(
  'a provisioned container authenticates, stores a recording index and serves scoped byte ranges',
  { skip: !configured, timeout: 120000 },
  async () => {
    const report = await exerciseProtocol(required(configured), {
      recordingId: process.env.HAUS_NVR_TEST_RECORDING_ID,
      keepFixture: process.env.HAUS_NVR_TEST_KEEP_FIXTURE === '1',
    });
    console.log(JSON.stringify(report));
  },
);
