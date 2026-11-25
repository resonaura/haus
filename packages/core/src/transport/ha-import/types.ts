/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export const MAX_HA_DATA_TRANSFER_BYTES = 80 * 1024;

export interface HaImportSubentry {
  readonly subentryId: string;
  readonly subentryType: string;
  readonly title: string;
  readonly data: Record<string, unknown>;
  readonly uniqueId?: string | null;
}

export interface HaImportArea {
  readonly id: string;
  readonly name: string;
}

export interface HaImportEntry {
  readonly entry: {
    readonly entryId: string;
    readonly domain: string;
    readonly title: string;
    readonly data: Record<string, unknown>;
    readonly options?: Record<string, unknown>;
    readonly uniqueId?: string | null;
    readonly version?: number;
    readonly minorVersion?: number;
    readonly disabledBy: 'user';
    readonly subentries?: readonly HaImportSubentry[];
  };
  readonly entities?: readonly Record<string, unknown>[];
  readonly devices?: readonly Record<string, unknown>[];
  readonly areas?: readonly HaImportArea[];
}

export interface HaImportSummary {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly devices: number;
  readonly entities: number;
}

export interface HaDataImportProgress {
  readonly completed: number;
}

export interface HaDataImportResult {
  readonly completed: number;
  readonly imported: number;
}
