/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonFile, rollbackComponentSwap } from './archive-stage.js';
import type { PersistedHacsState } from './repository-catalog.js';
import type {
  HacsBatchUpdateResult,
  HacsEntryCheckpoint,
  HacsRuntimeHooks,
  HacsUpdateOperation,
} from './update-types.js';

export async function loadPersistedHacsUpdaterState(storageDir: string): Promise<{
  readonly state?: PersistedHacsState;
  readonly operations: readonly HacsUpdateOperation[];
}> {
  await mkdir(storageDir, { recursive: true, mode: 0o700 });
  const parsed = await readJsonFile<Partial<PersistedHacsState>>(
    join(storageDir, 'hacs-state.json'),
  );
  const state: PersistedHacsState | undefined = parsed
    ? {
        repositories: parsed.repositories ?? {},
        acknowledgedCritical: Array.isArray(parsed.acknowledgedCritical)
          ? parsed.acknowledgedCritical
          : [],
        removed: Array.isArray(parsed.removed) ? parsed.removed : [],
      }
    : undefined;
  const parsedOps = await readJsonFile<HacsUpdateOperation[]>(
    join(storageDir, 'hacs-operations.json'),
  );
  return {
    state,
    operations: Array.isArray(parsedOps) ? parsedOps.filter((op) => Boolean(op?.operationId)) : [],
  };
}

export async function resolveFailedHacsUpdateRollback(params: {
  readonly err: unknown;
  readonly domain: string;
  readonly stageDir: string;
  readonly targetDir: string;
  readonly backupDir: string;
  readonly backupCreated: boolean;
  readonly codeSwapped: boolean;
  readonly installedVersion: string;
  readonly affectedEntries: readonly string[];
  readonly checkpoints: readonly HacsEntryCheckpoint[];
  readonly hooks: HacsRuntimeHooks;
}): Promise<{
  readonly errorMsg: string;
  readonly rollbackOutcome: HacsUpdateOperation['rollbackOutcome'];
  readonly runningVersion: string;
}> {
  const errorMsg = params.err instanceof Error ? params.err.message : String(params.err);
  const irreversible = Boolean(
    params.err &&
    typeof params.err === 'object' &&
    'irreversibleMigration' in params.err &&
    params.err.irreversibleMigration,
  );
  await rm(params.stageDir, { recursive: true, force: true }).catch(() => undefined);
  let rollbackOutcome: HacsUpdateOperation['rollbackOutcome'] = 'not_needed';
  let runningVersion = params.installedVersion;
  if (params.codeSwapped) {
    await params.hooks
      .fenceCandidate?.(params.domain, params.affectedEntries)
      .catch(() => undefined);
    if (irreversible) {
      rollbackOutcome = 'unresolved_migration';
      runningVersion = 'unknown';
    } else {
      try {
        await rollbackComponentSwap({
          targetDir: params.targetDir,
          backupDir: params.backupDir,
          backupCreated: params.backupCreated,
        });
        if (params.checkpoints.length > 0) {
          await params.hooks.restoreEntryCheckpoint?.(params.domain, params.checkpoints);
        }
        await params.hooks.verifyRestoredRuntime?.(
          params.domain,
          params.installedVersion,
          params.affectedEntries,
        );
        rollbackOutcome = 'restored';
        runningVersion = params.installedVersion;
      } catch {
        rollbackOutcome = 'failed';
        runningVersion = 'unknown';
      }
    }
  }
  return { errorMsg, rollbackOutcome, runningVersion };
}

export async function runHacsBatchUpdates(params: {
  readonly identifiers: readonly string[];
  readonly installOne: (id: string) => Promise<HacsUpdateOperation>;
  readonly findLatestOperation: (id: string) => HacsUpdateOperation | undefined;
  readonly onBatchProgress?: (p: {
    readonly completedCount: number;
    readonly totalCount: number;
    readonly currentOperation: HacsUpdateOperation;
  }) => void;
}): Promise<HacsBatchUpdateResult> {
  const succeeded: HacsUpdateOperation[] = [];
  const failed: HacsUpdateOperation[] = [];
  const totalCount = params.identifiers.length;
  for (const id of params.identifiers) {
    try {
      const op = await params.installOne(id);
      succeeded.push(op);
      params.onBatchProgress?.({
        completedCount: succeeded.length + failed.length,
        totalCount,
        currentOperation: op,
      });
    } catch {
      const latestOp = params.findLatestOperation(id);
      if (latestOp) {
        failed.push(latestOp);
        params.onBatchProgress?.({
          completedCount: succeeded.length + failed.length,
          totalCount,
          currentOperation: latestOp,
        });
      }
    }
  }
  return { completedCount: succeeded.length, totalCount, succeeded, failed };
}

export async function recoverInterruptedHacsOperations(params: {
  readonly operations: Iterable<HacsUpdateOperation>;
  readonly backupRoot: string;
  readonly customComponentsDir: string;
  readonly hooks: HacsRuntimeHooks;
  readonly advanceOp: (
    op: HacsUpdateOperation,
    patch: Partial<HacsUpdateOperation>,
  ) => Promise<HacsUpdateOperation>;
}): Promise<readonly HacsUpdateOperation[]> {
  const recovered: HacsUpdateOperation[] = [];
  for (const op of params.operations) {
    if (!['activate', 'verify', 'prepare', 'download'].includes(op.phase)) continue;
    const backupDir = join(params.backupRoot, `${op.domain}-${op.operationId}`);
    const targetDir = join(params.customComponentsDir, op.domain);
    let rollbackOutcome: HacsUpdateOperation['rollbackOutcome'] = 'not_needed';
    if (op.phase === 'activate' || op.phase === 'verify') {
      try {
        await params.hooks.fenceCandidate?.(op.domain, op.affectedEntries);
        if (await rollbackComponentSwap({ targetDir, backupDir })) {
          await params.hooks.verifyRestoredRuntime?.(
            op.domain,
            op.installedVersion,
            op.affectedEntries,
          );
          rollbackOutcome = 'restored';
        }
      } catch {
        rollbackOutcome = 'failed';
      }
    }
    recovered.push(
      await params.advanceOp(op, {
        phase: rollbackOutcome === 'restored' ? 'rolled_back' : 'failed',
        failedPhase: op.phase,
        rollbackOutcome,
        runningVersion: op.installedVersion,
        error: 'interrupted_operation_recovered',
      }),
    );
  }
  return recovered;
}
