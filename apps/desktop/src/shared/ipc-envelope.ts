/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/**
 * Structured IPC error envelope returned from `ipcMain.handle` as a resolved payload
 * and rethrown as a standard `Error` in preload so Electron never dumps stack traces
 * to the main-process console for normal/expected operational errors.
 */
export interface HausIpcErrorEnvelope {
  readonly __hausIpcError: true;
  readonly message: string;
  readonly name?: string;
  readonly code?: string;
}

export function packIpcError(error: unknown): HausIpcErrorEnvelope {
  if (error instanceof Error) {
    const rawCode = (error as { code?: unknown }).code;
    const code = typeof rawCode === 'string' && rawCode ? rawCode : undefined;
    return {
      __hausIpcError: true,
      message: error.message || error.name || 'Request failed.',
      ...(error.name && error.name !== 'Error' ? { name: error.name } : {}),
      ...(code ? { code } : {}),
    };
  }
  return {
    __hausIpcError: true,
    message: typeof error === 'string' && error ? error : String(error),
  };
}

export function isIpcErrorEnvelope(value: unknown): value is HausIpcErrorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __hausIpcError?: unknown }).__hausIpcError === true &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

export function unpackIpcResult<T>(value: T | HausIpcErrorEnvelope): T {
  if (!isIpcErrorEnvelope(value)) return value;
  const err = new Error(value.message);
  if (value.name) err.name = value.name;
  if (value.code) (err as Error & { code?: string }).code = value.code;
  throw err;
}
