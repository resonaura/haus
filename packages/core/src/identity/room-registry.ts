/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Room } from '../types.js';
import { slugifySegment } from './rewrites.js';

export const UNASSIGNED_ROOM_ID = 'unassigned';

const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ґ: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  є: 'ye',
  ж: 'zh',
  з: 'z',
  и: 'i',
  і: 'i',
  ї: 'yi',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

function transliterateForSlug(value: string): string {
  let out = '';
  for (const ch of value.toLowerCase()) {
    out += CYRILLIC_TO_LATIN[ch] ?? ch;
  }
  return out;
}

/** Validate and normalize a human-entered room name (1..120 collapsed chars). */
export function normalizeRoomName(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > 120) {
    throw new Error('invalid_room_name');
  }
  return normalized;
}

/** Normalize an optional room icon identifier; empty or whitespace clears the icon. */
export function normalizeRoomIcon(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return undefined;
  return trimmed;
}

/** Humanize a room identifier into a readable display label when no explicit name was persisted. */
export function formatFallbackRoomName(roomId: string): string {
  const cleaned = roomId.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return roomId;
  return cleaned.replace(/^./, (ch) => ch.toUpperCase());
}

/** Generate a deterministic, collision-free ASCII lowercase slug id for a room name. */
export function allocateRoomId(name: string, existingIds: ReadonlySet<string>): string {
  const transliterated = transliterateForSlug(name);
  const rawSlug = slugifySegment(transliterated);
  const base = rawSlug === 'item' || rawSlug === UNASSIGNED_ROOM_ID ? 'room' : rawSlug;

  if (!existingIds.has(base) && base !== UNASSIGNED_ROOM_ID) {
    return base;
  }

  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

/** Validate that a target room ID can be created or persisted as a named room. */
export function validateExplicitRoomId(roomId: string): string {
  const trimmed = roomId.trim();
  if (
    !trimmed ||
    trimmed.length > 120 ||
    trimmed === UNASSIGNED_ROOM_ID ||
    !/^[a-zA-Z0-9._:-]+$/.test(trimmed)
  ) {
    throw new Error('invalid_room_id');
  }
  return trimmed;
}

/** Ensure a room name is unique case-insensitively across all rooms except an optional self ID. */
export function assertUniqueRoomName(
  name: string,
  rooms: Iterable<Room>,
  excludeRoomId?: string,
): void {
  const needle = name.toLocaleLowerCase();
  for (const existing of rooms) {
    if (existing.id === excludeRoomId) continue;
    if (existing.name.trim().toLocaleLowerCase() === needle) {
      throw new Error('room_name_exists');
    }
  }
}

/** Normalize optional roomId inputs where null / empty / 'unassigned' mean unassigning from rooms. */
export function normalizeTargetRoomId(roomId: string | null | undefined): string {
  if (roomId === null || roomId === undefined) return UNASSIGNED_ROOM_ID;
  const trimmed = roomId.trim();
  if (!trimmed || trimmed === UNASSIGNED_ROOM_ID) return UNASSIGNED_ROOM_ID;
  return trimmed;
}
