/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { AppInstallProgressUpdate, AppInstallStage, ResolvedAppImage } from '@haus/apps';
import type { LiveService } from '../../live/types.js';
import type { AppInstallProgress } from './types.js';

const STAGE_BASE_PERCENT: Readonly<Record<AppInstallStage, number>> = {
  validating: 8,
  'checking-local': 16,
  pulling: 24,
  building: 55,
  ready: 78,
  creating: 86,
  starting: 94,
  complete: 100,
  failed: 100,
};

const STAGE_DEFAULT_DETAIL: Readonly<Record<AppInstallStage, string>> = {
  validating: 'Validating manifest & permissions…',
  'checking-local': 'Inspecting cached container layers…',
  pulling: 'Pulling container image layers…',
  building: 'Building container image…',
  ready: 'Image verified and ready.',
  creating: 'Creating isolated container…',
  starting: 'Starting runtime process…',
  complete: 'Installed and running.',
  failed: 'Installation failed.',
};

const MAX_PROGRESS_LOGS = 160;

function formatTs(): string {
  return new Date().toISOString().slice(11, 19);
}

function stageAnsiPrefix(stage: AppInstallStage): string {
  if (stage === 'complete') return '\x1b[32m[OK]\x1b[0m';
  if (stage === 'failed') return '\x1b[31m[ERROR]\x1b[0m';
  if (stage === 'pulling' || stage === 'building') return '\x1b[36m[PULL]\x1b[0m';
  return '\x1b[34m[INFO]\x1b[0m';
}

export class AppInstallProgressTracker {
  private readonly items = new Map<string, AppInstallProgress>();
  private readonly publishedAt = new Map<string, number>();

  constructor(private readonly liveService?: LiveService) {}

  get(appId: string): AppInstallProgress | undefined {
    const progress = this.items.get(appId);
    return progress ? { ...progress } : undefined;
  }

  reset(appId: string): void {
    this.items.delete(appId);
    this.publishedAt.delete(appId);
  }

  update(
    appId: string,
    update: AppInstallProgressUpdate,
    image?: ResolvedAppImage,
    errorCode?: string,
    errorMessage?: string,
  ): void {
    const prev = this.items.get(appId);
    const logs = prev?.logs ? [...prev.logs] : [];
    const basePct = STAGE_BASE_PERCENT[update.stage] ?? 10;
    let computedPct = update.percent ?? basePct;
    if (
      update.percent === undefined &&
      (update.stage === 'pulling' || update.stage === 'building') &&
      typeof update.current === 'number' &&
      typeof update.total === 'number' &&
      update.total > 0
    ) {
      const ratio = Math.max(0, Math.min(1, update.current / update.total));
      const span = update.stage === 'pulling' ? 50 : 22;
      computedPct = Math.round(basePct + ratio * span);
    }
    const percent =
      update.stage === 'complete' || update.stage === 'failed'
        ? computedPct
        : Math.max(prev?.percent ?? 0, computedPct);

    const stageChanged = prev?.stage !== update.stage;
    const detail =
      update.detail ??
      (errorMessage ? errorMessage : undefined) ??
      (stageChanged
        ? STAGE_DEFAULT_DETAIL[update.stage]
        : (prev?.detail ?? STAGE_DEFAULT_DETAIL[update.stage]));

    const appendLine = (raw: string) => {
      const trimmed = raw.trimEnd();
      if (!trimmed) return;
      const formatted =
        trimmed.startsWith('\x1b[') || /^\[\d{2}:\d{2}:\d{2}\]/.test(trimmed)
          ? trimmed
          : `\x1b[90m[${formatTs()}]\x1b[0m ${stageAnsiPrefix(update.stage)} ${trimmed}`;
      if (logs.at(-1) === formatted) return;
      logs.push(formatted);
      if (logs.length > MAX_PROGRESS_LOGS) {
        logs.splice(0, logs.length - MAX_PROGRESS_LOGS);
      }
    };

    if (stageChanged && !update.logLine) {
      appendLine(
        update.stage === 'failed' && (errorMessage || errorCode)
          ? `Failed: ${errorMessage ?? errorCode}`
          : STAGE_DEFAULT_DETAIL[update.stage],
      );
    }
    if (update.logLine) {
      appendLine(update.logLine);
    }
    if (update.logs) {
      for (const l of update.logs) appendLine(l);
    }

    const { logLine: _omit, ...rest } = update;
    this.items.set(appId, {
      appId,
      ...rest,
      percent,
      detail,
      logs,
      updatedAt: new Date().toISOString(),
      ...(errorCode ? { errorCode } : {}),
      ...(image ? { image } : prev?.image ? { image: prev.image } : {}),
    });

    if (this.items.size > 32) {
      const oldest = [...this.items.values()].sort((a, b) =>
        a.updatedAt.localeCompare(b.updatedAt),
      )[0];
      if (oldest) this.items.delete(oldest.appId);
    }

    const now = Date.now();
    const lastPublished = this.publishedAt.get(appId) ?? 0;
    if (
      now - lastPublished >= 250 ||
      stageChanged ||
      Boolean(update.logLine) ||
      update.stage === 'complete' ||
      update.stage === 'failed'
    ) {
      this.publishedAt.set(appId, now);
      this.liveService?.publish('apps');
    }
  }
}
