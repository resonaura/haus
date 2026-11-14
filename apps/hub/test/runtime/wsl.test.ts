/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { resolveRelayConfig } from '../../src/commissioning/lan/scanner.js';
import { hubMdnsAddresses, startHubMdnsAdvertisement } from '../../src/runtime/discovery.js';
import {
  assessWslEnvironment,
  detectWslEnvironment,
  isPrivateIpv4,
  isVirtualBridgeInterface,
  isWindowsMountPath,
  parseProcNetRouteDefaultGateway,
  parseWslConfSystemd,
  parseWslConfigNetworkingMode,
} from '../../src/runtime/wsl.js';

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '02:00:00:00:00:01',
    internal,
    cidr: `${address}/24`,
  };
}

describe('WSL2 environment helpers', () => {
  it('classifies RFC1918 private IPv4 addresses accurately', () => {
    expect(isPrivateIpv4('192.168.1.50')).toBe(true);
    expect(isPrivateIpv4('10.0.0.12')).toBe(true);
    expect(isPrivateIpv4('172.16.0.1')).toBe(true);
    expect(isPrivateIpv4('172.31.255.254')).toBe(true);
    expect(isPrivateIpv4('172.15.0.1')).toBe(false);
    expect(isPrivateIpv4('172.32.0.1')).toBe(false);
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateIpv4('not-an-ip')).toBe(false);
  });

  it('filters virtual bridge interfaces while keeping real LAN NICs', () => {
    for (const name of ['lo', 'docker0', 'br-01ab23cd', 'vethdead', 'tun0', 'tailscale0', 'vEthernet (WSL)', 'wsl0']) {
      expect(isVirtualBridgeInterface(name)).toBe(true);
    }
    for (const name of ['eth0', 'wlan0', 'en0', 'enp3s0']) {
      expect(isVirtualBridgeInterface(name)).toBe(false);
    }
  });

  it('detects Windows /mnt/<drive> paths without false-positiving on Linux ext4 paths', () => {
    expect(isWindowsMountPath('/mnt/c')).toBe(true);
    expect(isWindowsMountPath('/mnt/c/Users/alice/haus')).toBe(true);
    expect(isWindowsMountPath('/mnt/D/media')).toBe(true);
    expect(isWindowsMountPath('/mnt/c/../d/foo')).toBe(true);
    expect(isWindowsMountPath('/var/lib/haus')).toBe(false);
    expect(isWindowsMountPath('/home/alice/haus')).toBe(false);
    expect(isWindowsMountPath('/mnt/data')).toBe(false);
  });

  it('parses /proc/net/route default gateway in both LE and BE host byte orders', () => {
    const leTable = [
      'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT',
      'eth0\t00000000\t010018AC\t0003\t0\t0\t0\t00000000\t0\t0\t0',
      'eth0\t000018AC\t00000000\t0001\t0\t0\t0\t000FF0FF\t0\t0\t0',
    ].join('\n');
    expect(parseProcNetRouteDefaultGateway(leTable, 'LE')).toBe('172.24.0.1');

    const beTable = 'eth0\t00000000\tAC180001\t0003\t0\t0\t0\t00000000\t0\t0\t0\n';
    expect(parseProcNetRouteDefaultGateway(`hdr\n${beTable}`, 'BE')).toBe('172.24.0.1');
  });

  it('parses /etc/wsl.conf [boot] systemd and .wslconfig [wsl2] networkingMode', () => {
    const bomWslConf = '\uFEFF# comment\n[boot]\nsystemd = true ; inline\n';
    expect(parseWslConfSystemd(bomWslConf)).toBe(true);
    expect(parseWslConfSystemd('[boot]\nsystemd=false\n')).toBe(false);
    expect(parseWslConfigNetworkingMode('[wsl2]\nmemory=8GB\nnetworkingMode=mirrored\n')).toBe('mirrored');
    expect(parseWslConfigNetworkingMode('[wsl2]\nnetworkingMode=nat\n')).toBe('nat');
  });

  it('detects Linux host vs WSL2 distro properly', () => {
    expect(
      detectWslEnvironment({
        env: {},
        kernelRelease: '6.8.0-45-generic',
        hasWslInterop: false,
        hasDockerEnv: false,
      }),
    ).toEqual({
      isWsl: false,
      isContainer: false,
      distroName: undefined,
      kernelRelease: '6.8.0-45-generic',
    });

    expect(
      detectWslEnvironment({
        env: { WSL_DISTRO_NAME: 'Ubuntu' },
        kernelRelease: '5.15.167.4-microsoft-standard-WSL2',
        hasWslInterop: true,
        hasDockerEnv: false,
      }),
    ).toMatchObject({
      isWsl: true,
      isContainer: false,
      distroName: 'Ubuntu',
    });
  });

  it('reports mirrored WSL2 cleanly when Linux ext4 + systemd + LAN IP are active', () => {
    const assessment = assessWslEnvironment({
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      kernelRelease: '5.15.167.4-microsoft-standard-WSL2',
      hasWslInterop: true,
      hasDockerEnv: false,
      systemdActive: true,
      wslConfContent: '[boot]\nsystemd=true\n',
      wslConfigContent: '[wsl2]\nnetworkingMode=mirrored\n',
      dataDirectory: '/var/lib/haus',
      interfaces: {
        lo: [ipv4('127.0.0.1', true)],
        docker0: [ipv4('172.17.0.1')],
        eth0: [ipv4('192.168.1.50')],
      },
    });

    expect(assessment.networkingMode).toBe('mirrored');
    expect(assessment.lanIps).toEqual(['192.168.1.50']);
    expect(assessment.natIps).toEqual([]);
    expect(assessment.dataOnWindowsMount).toBe(false);
    expect(assessment.diagnostics).toEqual(['wsl_mirrored_networking_active']);
    expect(assessment.warnings).toEqual([]);
  });

  it('flags WSL2 NAT limitations, inactive systemd, and /mnt/c data paths', () => {
    const route = 'Iface\tDestination\tGateway\neth0\t00000000\t010018AC\n';
    const assessment = assessWslEnvironment({
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      kernelRelease: '5.15.167.4-microsoft-standard-WSL2',
      hasWslInterop: true,
      hasDockerEnv: false,
      systemdActive: false,
      wslConfContent: '[boot]\nsystemd=false\n',
      routeTableContent: route,
      dataDirectory: '/mnt/c/haus-data',
      interfaces: {
        docker0: [ipv4('172.17.0.1')],
        eth0: [ipv4('172.24.8.15')],
      },
    });

    expect(assessment.networkingMode).toBe('nat');
    expect(assessment.natIps).toEqual(['172.24.8.15']);
    expect(assessment.dataOnWindowsMount).toBe(true);
    expect(assessment.unsafeWindowsMountPaths).toEqual(['/mnt/c/haus-data']);
    expect(assessment.diagnostics).toEqual(
      expect.arrayContaining([
        'wsl_nat_networking_detected',
        'wsl_nat_mdns_limited',
        'wsl_data_on_windows_mount',
        'wsl_systemd_inactive',
      ]),
    );
    if (assessment.defaultGatewayIp) {
      expect(assessment.recommendedRelayUrl).toBe(`http://${assessment.defaultGatewayIp}:8791`);
    }
  });
});

describe('WSL2 runtime discovery & LAN relay integration', () => {
  it('excludes docker0/br- bridges from hub mDNS addresses when interfaces are inspected', () => {
    const addresses = hubMdnsAddresses({}, new Set(['172.17.0.1', '192.168.1.50']), {
      docker0: [ipv4('172.17.0.1')],
      'br-123456abcdef': [ipv4('172.19.0.1')],
      eth0: [ipv4('192.168.1.50')],
    });
    expect(addresses).toContain('192.168.1.50');
    expect(addresses).not.toContain('172.17.0.1');
    expect(addresses).not.toContain('172.19.0.1');
  });

  it('skips mDNS advertisement and emits diagnostic under WSL2 NAT when no external IP is pinned', async () => {
    const diagnostics: string[] = [];
    const wslAssessment = assessWslEnvironment({
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      kernelRelease: '5.15.167.4-microsoft-standard-WSL2',
      hasWslInterop: true,
      hasDockerEnv: false,
      interfaces: { eth0: [ipv4('172.24.8.15')] },
    });
    const adv = await startHubMdnsAdvertisement({
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      wsl: wslAssessment,
      onDiagnostic: (code) => {
        diagnostics.push(code);
      },
    });
    expect(adv).toBeUndefined();
    expect(diagnostics).toContain('wsl_nat_mdns_limited');
  });

  it('auto-probes Windows LAN relay in WSL2 NAT when HAUS_LAN_RELAY_URL is unset and respects opt-out', () => {
    const route = 'Iface\tDestination\tGateway\neth0\t00000000\t010018AC\n';
    const natProbe = {
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      kernelRelease: '5.15.167.4-microsoft-standard-WSL2',
      hasWslInterop: true,
      hasDockerEnv: false,
      routeTableContent: route,
      interfaces: { eth0: [ipv4('172.24.8.15')] },
    };

    const autoRelay = resolveRelayConfig({}, natProbe);
    expect(autoRelay).toBeDefined();
    expect(autoRelay?.autoProbed).toBe(true);
    expect(autoRelay?.url).toMatch(/^http:\/\/[0-9.]+:8791$/);

    expect(resolveRelayConfig({ HAUS_LAN_RELAY_URL: '0' }, natProbe)).toBeUndefined();
    expect(resolveRelayConfig({ HAUS_LAN_RELAY_URL: 'off' }, natProbe)).toBeUndefined();
    expect(
      resolveRelayConfig(
        {},
        {
          env: {},
          kernelRelease: '6.8.0-generic',
          hasWslInterop: false,
          hasDockerEnv: false,
          interfaces: { eth0: [ipv4('192.168.1.50')] },
        },
      ),
    ).toBeUndefined();
  });
});
