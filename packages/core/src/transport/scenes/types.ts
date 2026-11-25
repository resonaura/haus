/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { asRecord } from '../automations/types.js';

export const MAX_SCENE_TRANSFER_BYTES = 256 * 1024;

export interface HaSceneImport {
  readonly id: string;
  readonly name: string;
  readonly haEntityId: string;
  readonly icon?: string;
  readonly areaName?: string;
  readonly entities: Record<string, unknown>;
}

export interface SceneImportSummary {
  readonly id: string;
  readonly name: string;
  readonly entities: number;
  readonly exists: boolean;
  readonly areaName?: string;
  readonly restoreRoom?: boolean;
}

export interface SceneRoomRef {
  readonly id: string;
  readonly name: string;
}

export interface SceneImportProgress {
  readonly entries: readonly SceneImportSummary[];
  readonly completed: number;
}

export interface SceneImportResult {
  readonly entries: readonly SceneImportSummary[];
  readonly completed: number;
  readonly stagedCount: number;
}

export function formatSceneTargetSetting(setting: unknown): {
  readonly targetSummary: string;
  readonly attributes?: Record<string, unknown>;
} {
  const values = asRecord(setting);
  const nestedAttributes = values ? asRecord(values.attributes) : undefined;
  const attributes = nestedAttributes ?? values;
  const state = typeof setting === 'string' ? setting : values?.state;
  const brightness = attributes?.brightness;
  const baseState = state !== undefined ? String(state) : 'Target setting not supplied';
  const brightnessText =
    typeof brightness === 'number' ? ` · ${Math.round(brightness / 2.55)}% brightness` : '';
  return {
    targetSummary: `${baseState}${brightnessText}`,
    ...(attributes ? { attributes } : {}),
  };
}

export function parseRgbColorString(
  value: string | undefined,
): readonly [number, number, number] | undefined {
  const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value ?? '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}
