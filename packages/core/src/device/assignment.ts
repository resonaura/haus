/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HausDevice } from './types.js';

export interface ExplicitRoomAssignment {
  readonly roomId: string;
  readonly updatedAt: number;
  readonly explicit: true;
}

export interface ExplicitNameAssignment {
  readonly name: string;
  readonly updatedAt: number;
  readonly explicit: true;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** True when a roomId represents an empty, default, or unassigned placeholder rather than a room. */
export function isUnassignedRoomId(roomId: string | undefined | null): boolean {
  if (!roomId) return true;
  const trimmed = roomId.trim();
  return trimmed.length === 0 || trimmed === 'unassigned' || trimmed === 'default';
}

export function readExplicitRoomAssignment(
  device: Pick<HausDevice, 'opaqueMetadata'> | undefined,
): ExplicitRoomAssignment | undefined {
  const raw = device?.opaqueMetadata?.roomAssignment;
  if (!isPlainRecord(raw)) return undefined;
  if (raw.explicit !== true) return undefined;
  if (typeof raw.roomId !== 'string' || raw.roomId.trim().length === 0) return undefined;
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt) || raw.updatedAt <= 0) {
    return undefined;
  }
  return {
    roomId: raw.roomId.trim(),
    updatedAt: raw.updatedAt,
    explicit: true,
  };
}

export function readExplicitNameAssignment(
  device: Pick<HausDevice, 'opaqueMetadata'> | undefined,
): ExplicitNameAssignment | undefined {
  const raw = device?.opaqueMetadata?.nameAssignment;
  if (!isPlainRecord(raw)) return undefined;
  if (raw.explicit !== true) return undefined;
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) return undefined;
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt) || raw.updatedAt <= 0) {
    return undefined;
  }
  return {
    name: raw.name.trim(),
    updatedAt: raw.updatedAt,
    explicit: true,
  };
}

/** Stamps a strictly monotonic user-authored room assignment onto a device. */
export function withExplicitRoomAssignment(
  device: HausDevice,
  roomId: string,
  nowMs = Date.now(),
): HausDevice {
  const previous = readExplicitRoomAssignment(device);
  const updatedAt = Math.max(nowMs, (previous?.updatedAt ?? 0) + 1);
  return {
    ...device,
    roomId,
    areaId: roomId,
    opaqueMetadata: {
      ...device.opaqueMetadata,
      roomAssignment: {
        roomId,
        updatedAt,
        explicit: true,
      } satisfies ExplicitRoomAssignment,
    },
  };
}

/** Stamps a strictly monotonic user-authored display name onto a device. */
export function withExplicitNameAssignment(
  device: HausDevice,
  name: string,
  nowMs = Date.now(),
): HausDevice {
  const previous = readExplicitNameAssignment(device);
  const updatedAt = Math.max(nowMs, (previous?.updatedAt ?? 0) + 1);
  return {
    ...device,
    name,
    opaqueMetadata: {
      ...device.opaqueMetadata,
      nameAssignment: {
        name,
        updatedAt,
        explicit: true,
      } satisfies ExplicitNameAssignment,
    },
  };
}

/**
 * Reconciles an incoming device update against a previously stored device so periodic
 * integration polls, provider reconnects, or stale cluster syncs never overwrite user-owned
 * room assignments or renames.
 */
export function reconcileDeviceUserAssignments(
  previous: HausDevice | undefined,
  incoming: HausDevice,
): HausDevice {
  if (!previous) return incoming;

  const prevRoomExplicit = readExplicitRoomAssignment(previous);
  const incRoomExplicit = readExplicitRoomAssignment(incoming);
  const prevRoom = previous.roomId ?? previous.areaId;
  const incRoom = incoming.roomId ?? incoming.areaId;

  let preserveRoom = false;
  let winningRoomId = incoming.roomId;
  let winningAreaId = incoming.areaId;
  let winningRoomExplicit: ExplicitRoomAssignment | undefined = incRoomExplicit;

  if (prevRoomExplicit) {
    if (incRoomExplicit && incRoomExplicit.updatedAt > prevRoomExplicit.updatedAt) {
      winningRoomId = incRoomExplicit.roomId;
      winningAreaId = incRoomExplicit.roomId;
      winningRoomExplicit = incRoomExplicit;
    } else {
      preserveRoom = true;
      winningRoomId = prevRoomExplicit.roomId;
      winningAreaId = prevRoomExplicit.roomId;
      winningRoomExplicit = prevRoomExplicit;
    }
  } else if (incRoomExplicit) {
    winningRoomId = incRoomExplicit.roomId;
    winningAreaId = incRoomExplicit.roomId;
    winningRoomExplicit = incRoomExplicit;
  } else if (!isUnassignedRoomId(prevRoom) && isUnassignedRoomId(incRoom)) {
    preserveRoom = true;
    winningRoomId = prevRoom;
    winningAreaId = previous.areaId ?? prevRoom;
  } else if (
    !isUnassignedRoomId(incoming.roomId) &&
    incoming.roomId === previous.roomId &&
    incoming.areaId === undefined &&
    previous.areaId === previous.roomId
  ) {
    winningAreaId = previous.areaId;
  }

  const prevNameExplicit = readExplicitNameAssignment(previous);
  const incNameExplicit = readExplicitNameAssignment(incoming);
  let preserveName = false;
  let winningName = incoming.name;
  let winningNameExplicit: ExplicitNameAssignment | undefined = incNameExplicit;

  if (prevNameExplicit) {
    if (incNameExplicit && incNameExplicit.updatedAt > prevNameExplicit.updatedAt) {
      winningName = incNameExplicit.name;
      winningNameExplicit = incNameExplicit;
    } else {
      preserveName = true;
      winningName = prevNameExplicit.name;
      winningNameExplicit = prevNameExplicit;
    }
  } else if (incNameExplicit) {
    winningName = incNameExplicit.name;
    winningNameExplicit = incNameExplicit;
  }

  const nextOpaque: Record<string, unknown> = { ...incoming.opaqueMetadata };
  if (winningRoomExplicit) nextOpaque.roomAssignment = winningRoomExplicit;
  if (winningNameExplicit) nextOpaque.nameAssignment = winningNameExplicit;

  const sameName = winningName === previous.name;
  const sameEffectiveRoom = winningRoomId === previous.roomId;
  const overrodeIncomingRoom = preserveRoom && incoming.roomId !== winningRoomId;
  const prevEndpointsById = new Map(previous.endpoints.map((ep) => [ep.id, ep]));
  const endpoints = incoming.endpoints.map((ep) => {
    const prevEp = prevEndpointsById.get(ep.id);
    const resolvedEpName =
      preserveName && prevEp && ep.name === incoming.name ? prevEp.name : ep.name;
    const resolvedEpRoomId = preserveRoom
      ? (winningRoomId ?? prevEp?.roomId)
      : (ep.roomId ??
        (sameEffectiveRoom && prevEp && prevEp.roomId === winningRoomId
          ? prevEp.roomId
          : undefined));
    const resolvedEpAddress = overrodeIncomingRoom
      ? sameName
        ? prevEp?.address
        : undefined
      : (ep.address ?? (sameName && sameEffectiveRoom ? prevEp?.address : undefined));
    if (
      resolvedEpName === ep.name &&
      resolvedEpRoomId === ep.roomId &&
      resolvedEpAddress === ep.address
    ) {
      return ep;
    }
    const { address: _oldAddr, ...epRest } = ep;
    return {
      ...epRest,
      name: resolvedEpName,
      ...(resolvedEpRoomId !== undefined ? { roomId: resolvedEpRoomId } : {}),
      ...(resolvedEpAddress !== undefined ? { address: resolvedEpAddress } : {}),
    };
  });

  const resolvedAddress = overrodeIncomingRoom
    ? incoming.address !== undefined && sameName
      ? previous.address
      : undefined
    : incoming.address;

  const { address: _incomingAddr, ...incomingRest } = incoming;
  return {
    ...incomingRest,
    name: winningName,
    ...(resolvedAddress !== undefined ? { address: resolvedAddress } : {}),
    ...(winningRoomId !== undefined ? { roomId: winningRoomId } : {}),
    ...(winningAreaId !== undefined ? { areaId: winningAreaId } : {}),
    ...(Object.keys(nextOpaque).length > 0 ? { opaqueMetadata: nextOpaque } : {}),
    endpoints,
  };
}
