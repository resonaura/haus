/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  Injectable,
  Inject,
  Optional,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ClusterTransferManager, CLUSTER_TRANSFER_MANAGER } from './transfer.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Enforces ownership fencing invariant during Hub-to-Hub transfer.
 * While a coordinator is fenced, mutating operations (POST, PUT, PATCH, DELETE)
 * across domain endpoints (devices, scenes, automations, preferences, apps)
 * are rejected with 403 Forbidden (`coordinator_fenced`).
 * Read-only operations and transfer control routes remain accessible.
 */
@Injectable()
export class ClusterFencingGuard implements CanActivate {
  constructor(
    @Optional()
    @Inject(CLUSTER_TRANSFER_MANAGER)
    private readonly transferManager?: ClusterTransferManager,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.transferManager || !this.transferManager.isFenced()) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const method = req.method?.toUpperCase();

    if (SAFE_METHODS.has(method)) {
      return true;
    }

    const path = req.path || req.url || '';
    if (
      path.startsWith('/api/cluster/transfer') ||
      path.startsWith('/api/auth') ||
      path.startsWith('/health') ||
      path.startsWith('/api/health')
    ) {
      return true;
    }

    this.transferManager.assertNotFenced();
    return true;
  }
}
