/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { TransportEntityState } from './contract.js';

export interface CameraPtzButtons<T extends TransportEntityState = TransportEntityState> {
  up?: T;
  down?: T;
  left?: T;
  right?: T;
  zoomIn?: T;
  zoomOut?: T;
  stop?: T;
  home?: T;
}

const CAMERA_RELATED_DOMAINS = new Set([
  'light',
  'switch',
  'input_boolean',
  'select',
  'number',
  'button',
  'input_button',
]);

function labelOf(entity: TransportEntityState): string {
  return `${String(entity.attributes.friendly_name ?? '')} ${entity.entity_id}`
    .toLocaleLowerCase()
    .replace(/[_.-]+/g, ' ');
}

export function cameraPtzButtons<T extends TransportEntityState>(
  entities: readonly T[],
): CameraPtzButtons<T> | undefined {
  const result: CameraPtzButtons<T> = {};
  for (const entity of entities) {
    const domain = entity.entity_id.split('.')[0] ?? '';
    if (!['button', 'input_button'].includes(domain)) continue;
    const label = labelOf(entity);
    // Direction words can also belong to a camera/room name. Require a motor command.
    const direction =
      /\b(?:ptz|pan|tilt|move|turn|rotate|direction)(?: camera)? (left|right|up|down|north|south|east|west)\b/.exec(
        label,
      )?.[1];
    if (direction && ['left', 'west'].includes(direction) && !result.left) result.left = entity;
    else if (direction && ['right', 'east'].includes(direction) && !result.right)
      result.right = entity;
    else if (direction && ['up', 'north'].includes(direction) && !result.up) result.up = entity;
    else if (direction && ['down', 'south'].includes(direction) && !result.down)
      result.down = entity;
    if (/\bzoom (?:in|tele)\b/.test(label) && !result.zoomIn) result.zoomIn = entity;
    else if (/\bzoom (?:out|wide)\b/.test(label) && !result.zoomOut) result.zoomOut = entity;
    if (
      /\b(?:(?:stop|halt)(?: camera)? (?:ptz|pan|tilt|movement|motor)|(?:ptz|pan|tilt|movement|motor)(?: camera)? (?:stop|halt))\b/.test(
        label,
      ) &&
      !result.stop
    ) {
      result.stop = entity;
    }
    if (/\b(?:go home|home position|return home|preset home)\b/.test(label) && !result.home) {
      result.home = entity;
    }
  }
  const movementCount =
    Number(Boolean(result.up)) +
    Number(Boolean(result.down)) +
    Number(Boolean(result.left)) +
    Number(Boolean(result.right)) +
    Number(Boolean(result.zoomIn)) +
    Number(Boolean(result.zoomOut));
  return movementCount >= 2 ? result : undefined;
}

export function cameraPtzButtonIds<T extends TransportEntityState>(
  entities: readonly T[],
): Set<string> {
  const controls = cameraPtzButtons(entities);
  if (!controls) return new Set();
  const ids = new Set<string>();
  for (const key of ['up', 'down', 'left', 'right', 'zoomIn', 'zoomOut', 'stop', 'home'] as const) {
    const item = controls[key];
    if (item) ids.add(item.entity_id);
  }
  return ids;
}

/** Hides internal transport/unsupported Aqara controls from the camera settings drawer. */
export function isHiddenCameraControl(entity: TransportEntityState): boolean {
  const label = labelOf(entity);
  if (/\bp2p stream\b/.test(label)) return true;
  if (/\bptz cruise\b/.test(label)) return true;
  if (
    /\bhumans? track(?:ing)?\b/.test(label) &&
    ['unavailable', 'unknown'].includes(entity.state)
  ) {
    return true;
  }
  return false;
}

export function filterCameraRelatedControls<T extends TransportEntityState>(
  cameraId: string,
  entities: readonly T[],
  operatingIds: ReadonlySet<string> = new Set(),
): T[] {
  const ptzIds = cameraPtzButtonIds(entities);
  const seen = new Set<string>();
  const filtered: T[] = [];
  for (const entity of entities) {
    const id = entity.entity_id;
    if (id === cameraId || seen.has(id)) continue;
    const domain = id.split('.')[0] ?? '';
    if (!CAMERA_RELATED_DOMAINS.has(domain)) continue;
    if (operatingIds.has(id) || ptzIds.has(id) || isHiddenCameraControl(entity)) continue;
    if (entity.attributes.haus_segment_role !== undefined) continue;
    seen.add(id);
    filtered.push(entity);
  }
  return filtered;
}
