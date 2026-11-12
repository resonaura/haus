/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PRIVATE_ATTRIBUTE =
  /(?:password|passwd|token|secret|credential|authorization|auth|bearer|cookie|private[_-]?key|api[_-]?key|signature|sdp|(?:media|stream|camera)?[_-]?(?:url|uri))/i;

export const privateMediaState = (value: unknown): boolean =>
  typeof value === 'string' && /(?:https?|rtsps?|rtmp|srt|file):\/\/|data:/i.test(value);

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return privateMediaState(value) ? undefined : value;
  }
  if (Array.isArray(value)) return value.map(redactValue).filter((item) => item !== undefined);
  if (record(value)) return redactAttributes(value);
  return value === null || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined;
}

/** Prevent MQTT provider metadata from exposing credentials or private media URLs. */
export function redactAttributes(value: unknown): Record<string, unknown> {
  if (!record(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (PRIVATE_ATTRIBUTE.test(key)) return [];
      const safe = redactValue(item);
      return safe === undefined ? [] : [[key, safe]];
    }),
  );
}
