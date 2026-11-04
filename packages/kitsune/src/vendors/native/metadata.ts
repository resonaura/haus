/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { isBridgeProvider } from '../catalog/index.js';
export { isBridgeProvider };
export interface RegistryEntity {
  entity_id: string;
  device_id?: string;
  platform?: string;
  unique_id?: string;
  disabled_by?: unknown;
  hidden_by?: unknown;
}
interface State {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
}
export function bridgeAddon(slug: string, options: Record<string, unknown> = {}) {
  const provider = /(?:^|_)aqara-g5pro-mqtt$/.test(slug)
    ? 'aqara'
    : /(?:^|_)tuya-rtsp-bridge$/.test(slug)
      ? 'tuya'
      : undefined;
  if (!provider) return;
  const port = provider === 'aqara' ? 8580 : Number(options.api_port ?? 6766);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? { provider, port } : undefined;
}
export function operatingRole(entity: RegistryEntity, state?: State) {
  if (entity.platform === 'eufy_security') {
    if (entity.unique_id?.endsWith('_device_statusLed')) return 'indicator';
    if (entity.unique_id?.endsWith('_device_autoNightvision')) return 'nightVision';
  }
  if (entity.platform === 'tuya' && entity.unique_id?.endsWith('basic_indicator'))
    return 'indicator';
  const role = state?.attributes?.haus_camera_role;
  return role === 'indicator' || role === 'nightVision' ? role : undefined;
}
export function spotlightIdentity(
  entity: RegistryEntity,
  physical?: { manufacturer?: string; model?: string },
) {
  return (
    entity.platform === 'mqtt' &&
    /(?:^|_)spotlight$/.test(entity.unique_id ?? '') &&
    physical?.manufacturer?.toLowerCase() === 'aqara' &&
    /(?:\bg5\s*pro\b|agl004)/i.test(physical?.model ?? '')
  );
}
export function protectedNativeTransport(provider: string, transport: string) {
  return provider !== 'aqara' || transport === 'p2p';
}
export function requiresProtectedStream(
  camera: {
    id: string;
    aliases?: string[];
    deviceId?: string;
    deviceIds?: string[];
    playbackSource?: { platform?: string; manufacturer?: string };
  },
  states: State[],
  entities: RegistryEntity[],
) {
  const vendor = `${camera.playbackSource?.platform ?? ''} ${camera.playbackSource?.manufacturer ?? ''}`;
  if (/aqara/i.test(vendor)) return true;
  if (!/eufy/i.test(vendor)) return false;
  const entries = new Map(entities.map((entry) => [entry.entity_id, entry]));
  const names = new Set(
    [camera.id, ...(camera.aliases ?? [])].map(
      (id) => `sensor.${id.split('.')[1].replace(/_internal$/, '')}_stream_provider`,
    ),
  );
  const devices = new Set([camera.deviceId, ...(camera.deviceIds ?? [])].filter(Boolean));
  const providers = states.filter(
    (state) =>
      /^sensor\..*_stream_provider$/.test(state.entity_id) &&
      !entries.get(state.entity_id)?.disabled_by &&
      (names.has(state.entity_id) || devices.has(entries.get(state.entity_id)?.device_id)),
  );
  const exact = providers.filter((state) => names.has(state.entity_id)),
    selected = exact.length ? exact : providers;
  return selected.length !== 1 || selected[0].state !== 'RTSP';
}
export interface Provenance {
  kind?: string;
  profile?: number;
  platform?: string;
  manufacturer?: string;
  model?: string;
}
export function trustedCaptureProvenance(value?: Provenance) {
  return (
    value?.kind === 'camera' &&
    value.platform === 'eufy_security' &&
    value.manufacturer === 'Eufy Security' &&
    value.model === 'T8410C'
  );
}
export function trustedCaptureParameters(
  video?: {
    profile?: string;
    level?: number;
    width?: number;
    height?: number;
    has_b_frames?: number;
  },
  value?: Provenance,
) {
  return (
    trustedCaptureProvenance(value) &&
    video?.profile === 'High' &&
    video.level === 42 &&
    video.width === 1920 &&
    video.height === 1080 &&
    video.has_b_frames === 0
  );
}
