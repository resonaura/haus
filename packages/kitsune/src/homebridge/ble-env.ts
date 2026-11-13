/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type HomebridgeBleTransportMode = 'native_os' | 'raw_hci' | 'dbus' | 'unavailable';

export interface HomebridgeBleEnvironmentAssessment {
  readonly mode: HomebridgeBleTransportMode;
  readonly reason: string;
  readonly hasDbusSocket: boolean;
  readonly hasRawHciCap: boolean;
  readonly isContainer: boolean;
  readonly isWsl: boolean;
  readonly installHciSocketShim: boolean;
  readonly envOverrides: Readonly<Record<string, string>>;
}

export interface BleProbeInput {
  readonly platform?: NodeJS.Platform;
  readonly uid?: number;
  readonly capEffHex?: string;
  readonly hasRawHciCap?: boolean;
  readonly hasDbusSocket?: boolean;
  readonly hasVhciDevice?: boolean;
  readonly hciAdaptersPresent?: boolean;
  readonly isContainer?: boolean;
  readonly isWsl?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const CAP_NET_RAW_BIT = 13n;

export function parseEffectiveCapNetRaw(procStatusContent: string): boolean {
  const match = procStatusContent.match(/^CapEff:\s*([0-9a-fA-F]+)/m);
  if (!match?.[1]) return false;
  try {
    const mask = BigInt(`0x${match[1]}`);
    return (mask & (1n << CAP_NET_RAW_BIT)) !== 0n;
  } catch {
    return false;
  }
}

function readLinuxRawHciCapability(): { hasRawHciCap: boolean; hciAdaptersPresent: boolean } {
  let hasRawHciCap = typeof process.getuid === 'function' ? process.getuid() === 0 : false;
  try {
    const status = readFileSync('/proc/self/status', 'utf8');
    hasRawHciCap = parseEffectiveCapNetRaw(status);
  } catch {
    // Non-Linux or inaccessible /proc
  }

  let hciAdaptersPresent = false;
  try {
    hciAdaptersPresent = readdirSync('/sys/class/bluetooth').length > 0;
  } catch {
    hciAdaptersPresent = false;
  }

  return { hasRawHciCap, hciAdaptersPresent };
}

export function resolveHomebridgeBleEnvironment(
  probe: BleProbeInput = {},
): HomebridgeBleEnvironmentAssessment {
  const platform = probe.platform ?? process.platform;
  const env = probe.env ?? process.env;
  const explicitBinding = env.NOBLE_BINDINGS?.trim().toLowerCase();

  if (platform !== 'linux') {
    return {
      mode: 'native_os',
      reason: `native_${platform}_ble`,
      hasDbusSocket: false,
      hasRawHciCap: true,
      isContainer: false,
      isWsl: false,
      installHciSocketShim: false,
      envOverrides: {},
    };
  }

  const hasDbusSocket = probe.hasDbusSocket ?? existsSync('/run/dbus/system_bus_socket');
  const hasVhciDevice = probe.hasVhciDevice ?? existsSync('/dev/vhci');
  const isContainer =
    probe.isContainer ??
    (existsSync('/.dockerenv') || env.CONTAINER === 'true' || env.HAUS_CONTAINER === 'true');
  const isWsl =
    probe.isWsl ??
    (existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') ||
      release().toLowerCase().includes('microsoft'));

  const linuxCaps =
    probe.capEffHex !== undefined
      ? {
          hasRawHciCap: parseEffectiveCapNetRaw(`CapEff:\t${probe.capEffHex}`),
          hciAdaptersPresent: probe.hciAdaptersPresent ?? true,
        }
      : probe.hasRawHciCap !== undefined
        ? {
            hasRawHciCap: probe.hasRawHciCap,
            hciAdaptersPresent: probe.hciAdaptersPresent ?? true,
          }
        : readLinuxRawHciCapability();

  if (explicitBinding === 'dbus') {
    return {
      mode: hasDbusSocket ? 'dbus' : 'unavailable',
      reason: hasDbusSocket ? 'explicit_dbus_binding' : 'explicit_dbus_missing_socket',
      hasDbusSocket,
      hasRawHciCap: linuxCaps.hasRawHciCap,
      isContainer,
      isWsl,
      installHciSocketShim: hasDbusSocket,
      envOverrides: hasDbusSocket ? { NOBLE_BINDINGS: 'dbus' } : {},
    };
  }

  if (linuxCaps.hasRawHciCap && (linuxCaps.hciAdaptersPresent || hasVhciDevice || !isContainer)) {
    return {
      mode: 'raw_hci',
      reason: 'native_linux_hci',
      hasDbusSocket,
      hasRawHciCap: true,
      isContainer,
      isWsl,
      installHciSocketShim: false,
      envOverrides: {},
    };
  }

  // Least-privilege Linux Hubs (e.g. Docker USER node) mount BlueZ D-Bus without raw HCI caps.
  if (hasDbusSocket) {
    return {
      mode: 'dbus',
      reason: 'auto_dbus_without_raw_hci',
      hasDbusSocket: true,
      hasRawHciCap: linuxCaps.hasRawHciCap,
      isContainer,
      isWsl,
      installHciSocketShim: true,
      envOverrides: {
        NOBLE_BINDINGS: 'dbus',
      },
    };
  }

  return {
    mode: 'unavailable',
    reason: isWsl
      ? 'wsl2_no_hci_passthrough'
      : isContainer
        ? 'container_missing_dbus_or_raw_hci'
        : 'missing_bluetooth_transport',
    hasDbusSocket: false,
    hasRawHciCap: linuxCaps.hasRawHciCap,
    isContainer,
    isWsl,
    installHciSocketShim: false,
    envOverrides: {},
  };
}

let hciShimInstalled = false;

const HCI_SHIM_SOURCE = `
export default class BluetoothHciSocketShim {
  on() {}
  removeListener() {}
  bindRaw() {}
  bindUser() {}
  bindControl() {}
  isDevUp() { return true; }
  setFilter() {}
  start() {}
  stop() {}
  write() {}
}
`;

const HOOK_MODULE_SOURCE = `
const SHIM_URL = 'haus-ble://hci-socket-shim';
const SHIM_CODE = ${JSON.stringify(HCI_SHIM_SOURCE)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@stoprocent/bluetooth-hci-socket') {
    return { shortCircuit: true, url: SHIM_URL, format: 'module' };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url === SHIM_URL) {
    return { shortCircuit: true, format: 'module', source: SHIM_CODE };
  }
  return nextLoad(url, context);
}
`;

/**
 * Configures NOBLE_BINDINGS and installs a lightweight ESM hook bypassing
 * raw AF_BLUETOOTH socket preflight when Linux BlueZ D-Bus is active without CAP_NET_RAW.
 */
export function prepareHomebridgeBleRuntime(
  probe?: BleProbeInput,
): HomebridgeBleEnvironmentAssessment {
  const assessment = resolveHomebridgeBleEnvironment(probe);
  for (const [key, value] of Object.entries(assessment.envOverrides)) {
    if (!process.env[key]) process.env[key] = value;
  }
  if (assessment.installHciSocketShim && !hciShimInstalled) {
    const hookUrl = `data:text/javascript,${encodeURIComponent(HOOK_MODULE_SOURCE)}`;
    register(hookUrl);
    hciShimInstalled = true;
  }
  return assessment;
}

export function resolveSharedNodeModulesPaths(): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const seeds = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const seed of seeds) {
    let cursor = seed;
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = join(cursor, 'node_modules');
      if (existsSync(candidate) && !seen.has(candidate)) {
        seen.add(candidate);
        ordered.push(candidate);
      }
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return ordered;
}
