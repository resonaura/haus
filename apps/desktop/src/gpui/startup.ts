/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { GpuiCredentialStore } from '../platform/credentials.js';

export interface GpuiStartupOptions {
  readonly demo: boolean;
  readonly forceLive: boolean;
}

export interface GpuiStartupSessionLike {
  readonly store: Pick<GpuiCredentialStore, 'loadHubSession' | 'loadSession' | 'close'>;
  readonly runtime: { dispose(): void };
  readonly streams: { close(): Promise<void> };
}

export interface GpuiStartupResolution<TSession extends GpuiStartupSessionLike> {
  readonly initial?: TSession;
  readonly initialError?: string;
  readonly showLive: boolean;
}

export function resolveGpuiStartupOptions(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): GpuiStartupOptions {
  const forceLive = argv.includes('--live');
  const demo = !forceLive && (argv.includes('--demo') || env.HAUS_GPUI_DEMO === '1');
  return { demo, forceLive };
}

async function hasSavedSession(
  store: Pick<GpuiCredentialStore, 'loadHubSession' | 'loadSession'>,
): Promise<boolean> {
  let hasSaved = false;
  try {
    if ((await store.loadHubSession()) !== null) hasSaved = true;
  } catch {
    // A saved Hub session exists in the store even if unreadable; open LiveHome so recovery is visible.
    return true;
  }
  if (hasSaved) return true;
  try {
    return (await store.loadSession()) !== null;
  } catch {
    return true;
  }
}

export async function resolveInitialGpuiSession<TSession extends GpuiStartupSessionLike>({
  demo,
  forceLive,
  hasExistingSession,
  openSession,
  clearSessionCache,
}: GpuiStartupOptions & {
  readonly hasExistingSession: boolean;
  readonly openSession: () => Promise<TSession>;
  readonly clearSessionCache: () => void;
}): Promise<GpuiStartupResolution<TSession>> {
  if (hasExistingSession) {
    return { initial: await openSession(), showLive: true };
  }
  if (demo) {
    return { showLive: false };
  }
  if (forceLive) {
    try {
      const initial = await openSession();
      return { initial, showLive: true };
    } catch (error) {
      return {
        initialError:
          error instanceof Error ? error.message : 'The Hub session store is unavailable.',
        showLive: false,
      };
    }
  }

  let candidate: TSession;
  try {
    candidate = await openSession();
  } catch {
    clearSessionCache();
    return { showLive: false };
  }

  if (await hasSavedSession(candidate.store)) {
    return { initial: candidate, showLive: true };
  }

  try {
    await candidate.streams.close().catch(() => undefined);
    candidate.runtime.dispose();
  } finally {
    await candidate.store.close().catch(() => undefined);
    clearSessionCache();
  }
  return { showLive: false };
}
