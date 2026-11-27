/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { IClusterService } from '../cluster.controller.js';

export async function dispatchCoordinatorProxyCall(params: {
  readonly senderHubId?: string;
  readonly clusterService?: IClusterService;
  readonly action?: string;
  readonly payload?: Record<string, unknown>;
}): Promise<{ readonly ok: true; readonly result: unknown }> {
  if (!params.senderHubId || !params.clusterService) {
    throw new ForbiddenException({ error: 'cluster_service_unavailable' });
  }
  const payload = params.payload ?? {};
  switch (params.action) {
    case 'rebalance':
      return { ok: true, result: await params.clusterService.rebalance?.(payload) };
    case 'enroll_hub':
      if (typeof payload.targetUrl !== 'string') {
        throw new BadRequestException({ error: 'invalid_node_url' });
      }
      return {
        ok: true,
        result: await params.clusterService.enrollHub?.({
          targetUrl: payload.targetUrl,
          ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
          ...(Array.isArray(payload.roles)
            ? { roles: payload.roles.filter((r): r is string => typeof r === 'string') }
            : {}),
          ...(typeof payload.pairingCode === 'string' ? { pairingCode: payload.pairingCode } : {}),
          ...(typeof payload.challengeSessionId === 'string'
            ? { challengeSessionId: payload.challengeSessionId }
            : {}),
        }),
      };
    case 'transfer_initiate':
      if (typeof payload.targetHubId !== 'string') {
        throw new BadRequestException({ error: 'invalid_target_hub_id' });
      }
      return {
        ok: true,
        result: await params.clusterService.initiateTransfer?.({
          targetHubId: payload.targetHubId,
          ...(typeof payload.preservePairing === 'boolean'
            ? { preservePairing: payload.preservePairing }
            : {}),
        }),
      };
    case 'transfer_prepare':
      return {
        ok: true,
        result: await params.clusterService.prepareTransfer?.(String(payload.id ?? '')),
      };
    case 'transfer_fence':
      return {
        ok: true,
        result: await params.clusterService.fenceTransfer?.(String(payload.id ?? '')),
      };
    case 'transfer_commit':
      return {
        ok: true,
        result: await params.clusterService.commitTransfer?.(String(payload.id ?? '')),
      };
    case 'transfer_rollback':
      return {
        ok: true,
        result: await params.clusterService.rollbackTransfer?.(
          String(payload.id ?? ''),
          typeof payload.reason === 'string' ? payload.reason : undefined,
        ),
      };
    default:
      throw new BadRequestException({ error: 'unsupported_coordinator_proxy_action' });
  }
}
