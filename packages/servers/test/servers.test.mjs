/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeHostReport,
  parseOsRelease,
  parseHostCpuModel,
  sampleCpuDelta,
  parseMacBattery,
  parseWindowsBattery,
  sign,
  authenticator,
  nodeAddress,
  storageMedia,
  udevMediaAttributes,
} from '../dist/index.js';

describe('@haus/servers contracts', () => {
  it('sanitizes valid host telemetry reports', () => {
    const now = Date.now();
    const raw = {
      sampledAt: new Date(now - 1000).toISOString(),
      scope: 'host',
      hostname: 'haus-test-server',
      platform: 'linux',
      cpu: {
        model: 'AMD Ryzen 9 5950X',
        logicalCores: 32,
        usage: 0.15,
        loadAverage: [1.2, 0.8, 0.5],
      },
      memory: {
        totalBytes: 64 * 1024 ** 3,
        availableBytes: 48 * 1024 ** 3,
        usedBytes: 16 * 1024 ** 3,
      },
      disks: [
        {
          id: 'block:nvme0n1',
          name: 'Samsung 980 Pro',
          kind: 'disk',
          type: 'disk',
          totalBytes: 1000 * 1024 ** 3,
          transport: 'nvme',
        },
      ],
    };

    const sanitized = sanitizeHostReport(raw, now);
    assert.equal(sanitized.hostname, 'haus-test-server');
    assert.equal(sanitized.platform, 'linux');
    assert.equal(sanitized.cpu.logicalCores, 32);
    assert.equal(sanitized.cpu.usage, 0.15);
    assert.equal(sanitized.memory.totalBytes, 64 * 1024 ** 3);
    assert.equal(sanitized.disks.length, 1);
    assert.equal(sanitized.disks[0].transport, 'nvme');
  });

  it('rejects stale or future host reports', () => {
    const now = Date.now();
    const stale = {
      sampledAt: new Date(now - 45000).toISOString(),
      scope: 'host',
      memory: { totalBytes: 1000, availableBytes: 500, usedBytes: 500 },
      cpu: { logicalCores: 4 },
    };
    assert.throws(() => sanitizeHostReport(stale, now), /invalid_host_report/);

    const future = {
      sampledAt: new Date(now + 10000).toISOString(),
      scope: 'host',
      memory: { totalBytes: 1000, availableBytes: 500, usedBytes: 500 },
      cpu: { logicalCores: 4 },
    };
    assert.throws(() => sanitizeHostReport(future, now), /invalid_host_report/);
  });

  it('parses OS release without evaluating shell syntax', () => {
    const content = `
NAME="Ubuntu"
VERSION="24.04 LTS (Noble Numbat)"
ID=ubuntu
ID_LIKE=debian
PRETTY_NAME="Ubuntu 24.04 LTS"
VERSION_ID="24.04"
HOME_URL="https://www.ubuntu.com/"
SUPPORT_URL="https://help.ubuntu.com/"
BUG_REPORT_URL="https://bugs.launchpad.net/ubuntu/"
PRIVACY_POLICY_URL="https://www.ubuntu.com/legal/terms-and-policies/privacy-policy"
UBUNTU_CODENAME=noble
`;
    const res = parseOsRelease(content);
    assert.equal(res.distribution, 'ubuntu');
    assert.equal(res.osName, 'Ubuntu 24.04 LTS');
  });

  it('resolves ARM CPU model from procfs implementer and part', () => {
    const cpuinfo = `
processor	: 0
BogoMIPS	: 108.00
Features	: fp asimd evtstrm crc32 cpuid
CPU implementer	: 0x41
CPU architecture: 8
CPU variant	: 0x0
CPU part	: 0xd08
CPU revision	: 3

processor	: 1
BogoMIPS	: 108.00
Features	: fp asimd evtstrm crc32 cpuid
CPU implementer	: 0x41
CPU architecture: 8
CPU variant	: 0x0
CPU part	: 0xd08
CPU revision	: 3
`;
    const model = parseHostCpuModel(cpuinfo);
    assert.equal(model, 'ARM Cortex-A72');
  });

  it('computes CPU utilization from delta proc samples', async () => {
    const readFn = async () => `cpu  1000 0 200 8000 50 0 0 0\n`;
    const cpus = [{ times: { user: 1000, nice: 0, sys: 200, idle: 8000, irq: 0 } }];
    const first = await sampleCpuDelta(cpus, null, {
      platform: 'linux',
      container: false,
      read: readFn,
    });
    assert.equal(first.usage, null);

    const secondRead = async () => `cpu  1500 0 300 8200 50 0 0 0\n`;
    const second = await sampleCpuDelta(cpus, first.sample, {
      platform: 'linux',
      container: false,
      read: secondRead,
    });
    // elapsed total = 10050 - 9250 = 800
    // elapsed idle = (8200 + 50) - (8000 + 50) = 200
    // usage = 1 - 200/800 = 0.75
    assert.equal(second.usage, 0.75);
  });

  it('parses Mac and Windows battery diagnostics', () => {
    const macOutput = `
Now drawing from 'AC Power'
 -InternalBattery-0 (id=4653155)	85%; charging; 0:45 remaining present: true
`;
    const macBatt = parseMacBattery(macOutput);
    assert.ok(macBatt);
    assert.equal(macBatt.level, 85);
    assert.equal(macBatt.charging, true);
    assert.equal(macBatt.powerConnected, true);

    const winData = {
      Battery: [{ EstimatedChargeRemaining: 92, BatteryStatus: 2 }],
      BatteryStatus: [{ Active: true, Charging: true, PowerOnline: true }],
    };
    const winBatt = parseWindowsBattery(winData);
    assert.ok(winBatt);
    assert.equal(winBatt.level, 92);
    assert.equal(winBatt.charging, true);
    assert.equal(winBatt.powerConnected, true);
  });

  it('validates node address security rules', () => {
    assert.equal(nodeAddress('https://192.168.1.100:8443/'), 'https://192.168.1.100:8443');
    assert.equal(nodeAddress('http://192.168.1.100:8080/', true), 'http://192.168.1.100:8080');

    // Reject HTTP if not explicitly allowed
    assert.throws(() => nodeAddress('http://192.168.1.100:8080/'), /invalid_node_address/);
    // Reject path trailing segments
    assert.throws(() => nodeAddress('https://192.168.1.100/secret'), /invalid_node_address/);
    // Reject cloud metadata service (AWS/GCP/Azure link-local)
    assert.throws(() => nodeAddress('https://169.254.169.254/'), /invalid_node_address/);
    // Reject auth credentials in URL
    assert.throws(() => nodeAddress('https://user:pass@192.168.1.100/'), /invalid_node_address/);
  });

  it('signs and verifies node requests with symmetric HMAC', () => {
    const key = 'a'.repeat(32);
    const auth = authenticator(key);

    const headers = sign(key, 'POST', '');
    assert.ok(headers['x-haus-signature']);
    assert.ok(headers['x-haus-nonce']);

    const valid = auth({ headers });
    assert.equal(valid, true);

    // Replay with identical nonce fails
    const replayed = auth({ headers });
    assert.equal(replayed, false);
  });

  it('classifies storage media and parses udev attributes', () => {
    const udev = 'E:ID_DRIVE_THUMB=1\nE:ID_SERIAL=private\n';
    const parsed = udevMediaAttributes(udev);
    assert.deepEqual(parsed, {
      ID_DRIVE_THUMB: '1',
    });

    const media = storageMedia({
      transport: 'usb',
      rotational: false,
      attributes: parsed,
    });
    assert.equal(media.mediaKind, 'flash');
    assert.equal(media.transport, 'usb');

    const sdMedia = storageMedia({
      transport: 'sdio',
      attributes: { MMC_TYPE: 'SD' },
    });
    assert.equal(sdMedia.mediaKind, 'sd');
  });
});
