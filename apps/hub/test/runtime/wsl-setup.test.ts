/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  formatWslPreflightReport,
  inspectWslPreflight,
  mergeIniKeys,
  mergeWslConfBootSystemd,
  mergeWslConfigMirrored,
  renderHubEnvFile,
  renderSystemdHubService,
} from '../../src/runtime/wsl-setup.js';

describe('WSL2 configuration mergers and generators', () => {
  it('merges INI keys without clobbering existing sections or comments', () => {
    const initial = [
      '\uFEFF# user config',
      '[wsl2]',
      'memory=8GB',
      'networkingMode=nat',
      '',
      '[experimental]',
      'autoMemoryReclaim=gradual',
    ].join('\n');

    const updated = mergeIniKeys(initial, 'wsl2', {
      networkingMode: 'mirrored',
      hostAddressLoopback: 'true',
    });

    expect(updated).not.toContain('\uFEFF');
    expect(updated).toContain('# user config');
    expect(updated).toContain('memory=8GB');
    expect(updated).toContain('networkingMode=mirrored');
    expect(updated).toContain('hostAddressLoopback=true');
    expect(updated).toContain('[experimental]\nautoMemoryReclaim=gradual');
  });

  it('produces valid [boot] systemd=true and [wsl2] mirrored blocks from empty files', () => {
    expect(mergeWslConfBootSystemd(undefined)).toBe('[boot]\nsystemd=true\n');
    expect(mergeWslConfigMirrored(undefined)).toBe(
      '[wsl2]\nnetworkingMode=mirrored\nhostAddressLoopback=true\ndnsTunneling=true\n',
    );
  });

  it('renders Hub env templates tailored for NAT fallback and mirrored LAN modes', () => {
    const natEnv = renderHubEnvFile({
      dataDirectory: '/var/lib/haus',
      port: 8790,
      networkingMode: 'nat',
      publicUrl: 'http://192.168.1.50:8790/',
    });
    expect(natEnv).toContain('HAUS_DATA_DIR=/var/lib/haus');
    expect(natEnv).toContain('HAUS_PUBLIC_URL=http://192.168.1.50:8790');
    expect(natEnv).toContain('HAUS_HUB_URL=http://192.168.1.50:8790');
    expect(natEnv).toContain('HAUS_WSL_NETWORKING=nat');
    expect(natEnv).toContain('HAUS_LAN_RELAY_URL=auto');
    expect(natEnv).toContain('HAUS_MDNS_ADVERTISE=0');

    const mirroredEnv = renderHubEnvFile({
      dataDirectory: '/var/lib/haus',
      port: 8790,
      networkingMode: 'mirrored',
      mdnsAddress: '192.168.1.50',
      nvrEnabled: true,
    });
    expect(mirroredEnv).toContain('HAUS_WSL_NETWORKING=mirrored');
    expect(mirroredEnv).toContain('HAUS_MDNS_ADVERTISE=1');
    expect(mirroredEnv).toContain('HAUS_MDNS_ADDRESS=192.168.1.50');
    expect(mirroredEnv).toContain('HAUS_ROLES=storage,stream');
  });

  it('renders hardened systemd unit for native Hub runtime', () => {
    const unit = renderSystemdHubService({
      workingDirectory: '/opt/haus',
      user: 'haus',
      readWritePaths: ['/var/lib/haus'],
    });
    expect(unit).toContain('WorkingDirectory=/opt/haus');
    expect(unit).toContain('ExecStart=/usr/bin/node apps/hub/dist/main.js');
    expect(unit).toContain('AmbientCapabilities=CAP_NET_RAW');
    expect(unit).toContain('ReadWritePaths=/var/lib/haus');
  });
});

describe('WSL2 preflight inspector', () => {
  it('flags /mnt/c data directories as blockers and resolves mocked Windows LAN IP', async () => {
    const report = await inspectWslPreflight({
      dataDirectory: '/mnt/c/haus-data',
      port: 8790,
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      probeWindows: true,
      fileExists: (path) => path === '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
      readText: async (path) => {
        if (path === '/mnt/c/Users/alice/.wslconfig') return '[wsl2]\nnetworkingMode=nat\n';
        if (path === '/etc/wsl.conf') return '[boot]\nsystemd=true\n';
        return undefined;
      },
      exec: async (file) => {
        if (file.endsWith('powershell.exe')) {
          return JSON.stringify({
            WslConfig: 'C:\\Users\\alice\\.wslconfig',
            LanIp: '192.168.1.50',
          });
        }
        if (file === '/usr/bin/wslpath') return '/mnt/c/Users/alice/.wslconfig\n';
        if (file === 'node') return 'v24.11.0\n';
        if (file === 'pnpm') return '11.22.0\n';
        throw new Error(`missing:${file}`);
      },
    });

    expect(report.ready).toBe(false);
    expect(report.dataDirectoryValid).toBe(false);
    expect(report.dataDirectoryReason).toBe('windows_mnt_drive_unsupported');
    expect(report.windowsLanIp).toBe('192.168.1.50');
    expect(report.publicUrlHint).toBe('http://192.168.1.50:8790');
    expect(report.blockers.some((b) => b.includes('/mnt'))).toBe(true);

    const formatted = formatWslPreflightReport(report);
    expect(formatted).toContain('Haus Hub Environment Preflight');
    expect(formatted).toContain('windows_mnt_drive_unsupported');
    expect(formatted).toContain('192.168.1.50');
  });

  it('passes readiness when Linux ext4 directory and Node.js runtime are present', async () => {
    const report = await inspectWslPreflight({
      dataDirectory: '/var/lib/haus',
      port: 8790,
      env: {},
      probeWindows: false,
      fileExists: () => false,
      readText: async () => undefined,
      exec: async (file) => {
        if (file === 'node') return 'v24.11.0\n';
        if (file === 'pnpm') return '11.22.0\n';
        if (file === 'ffmpeg') return 'ffmpeg version 7.0\n';
        throw new Error(`missing:${file}`);
      },
    });

    expect(report.dataDirectoryValid).toBe(true);
    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.publicUrlHint).toMatch(/^http:\/\/.+:8790$/);
  });
});
