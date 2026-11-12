/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Logger } from '@nestjs/common';
import {
  normalizeMac,
  type CommissioningProtocol,
  type DiscoveredCandidate,
  type DiscoveryRegistry,
} from '@haus/core';

export interface HandoverCriteria {
  readonly protocol: CommissioningProtocol;
  readonly identifier?: string;
  readonly mac?: string;
  readonly discriminator?: number;
  readonly setupHash?: string;
  readonly expectedName?: string;
  readonly initialAddress?: string;
  readonly timeoutMs?: number;
}

export interface ManualAddressInput {
  readonly address: string;
  readonly port?: number;
}

export interface HandoverResult {
  readonly address: string;
  readonly port?: number;
  readonly candidate: DiscoveredCandidate;
  readonly addressChanged: boolean;
  readonly manualFallback: boolean;
}

interface PendingHandover {
  readonly commissioningId: string;
  readonly criteria: HandoverCriteria;
  resolve(result: HandoverResult): void;
  reject(err: Error): void;
}

export class IpHandoverCoordinator {
  private readonly logger = new Logger(IpHandoverCoordinator.name);
  private readonly pending = new Map<string, PendingHandover>();

  constructor(private readonly discovery: DiscoveryRegistry) {}

  async waitForIp(
    commissioningId: string,
    criteria: HandoverCriteria,
    options?: { signal?: AbortSignal },
  ): Promise<HandoverResult> {
    if (this.pending.has(commissioningId)) {
      this.cancel(commissioningId);
    }

    const timeoutMs = criteria.timeoutMs ?? 30_000;
    const cleanMac = normalizeMac(criteria.mac);
    const cleanHapId = criteria.identifier?.toLowerCase();

    return new Promise<HandoverResult>((resolve, reject) => {
      const entry: PendingHandover = {
        commissioningId,
        criteria,
        resolve: (res) => {
          this.pending.delete(commissioningId);
          resolve(res);
        },
        reject: (err) => {
          this.pending.delete(commissioningId);
          reject(err);
        },
      };

      this.pending.set(commissioningId, entry);

      const predicate = (c: DiscoveredCandidate): boolean => {
        if (cleanMac) {
          const hasMac = c.durableIdentities.some(
            (id) => id.kind === 'mac' && id.value === `mac:${cleanMac}`,
          );
          if (hasMac) return true;
        }

        if (criteria.protocol === 'homekit' && cleanHapId) {
          const hasHap = c.durableIdentities.some(
            (id) => id.kind === 'hap' && id.value === `hap:${cleanHapId}`,
          );
          if (hasHap || c.id.toLowerCase().includes(cleanHapId)) return true;
        }

        if (criteria.setupHash && c.details.sh === criteria.setupHash) {
          return true;
        }

        if (criteria.protocol === 'matter' && criteria.discriminator !== undefined) {
          const disc =
            typeof c.details.discriminator === 'number'
              ? c.details.discriminator
              : typeof c.details.D === 'number'
                ? c.details.D
                : typeof c.details.D === 'string'
                  ? parseInt(c.details.D, 10)
                  : undefined;
          if (disc === criteria.discriminator) return true;
        }

        if (
          criteria.expectedName &&
          c.name.toLowerCase().includes(criteria.expectedName.toLowerCase())
        ) {
          return true;
        }

        return false;
      };

      void this.discovery
        .waitForCandidate(predicate, { timeoutMs, signal: options?.signal })
        .then((candidate) => {
          if (!this.pending.has(commissioningId)) return;

          if (!candidate) {
            if (options?.signal?.aborted) {
              entry.reject(new Error('handover_cancelled'));
            } else {
              this.logger.warn(
                `IP handover for commissioning ${commissioningId} timed out after ${timeoutMs}ms`,
              );
              entry.reject(new Error('network_join_timeout'));
            }
            return;
          }

          const resolvedAddress = candidate.addresses[0] ?? (candidate.details.host as string);
          if (!resolvedAddress) {
            entry.reject(new Error('no_ip_address_found'));
            return;
          }

          const addressChanged =
            criteria.initialAddress !== undefined && criteria.initialAddress !== resolvedAddress;

          entry.resolve({
            address: resolvedAddress,
            port: candidate.port,
            candidate,
            addressChanged,
            manualFallback: false,
          });
        })
        .catch((err: unknown) => {
          if (this.pending.has(commissioningId)) {
            entry.reject(err instanceof Error ? err : new Error('handover_failed'));
          }
        });
    });
  }

  resolveManualAddress(
    commissioningId: string,
    input: ManualAddressInput,
  ): HandoverResult | undefined {
    const entry = this.pending.get(commissioningId);
    if (!entry) return undefined;

    const syntheticCandidate: DiscoveredCandidate = {
      id: `manual:${input.address}:${input.port ?? 80}`,
      domain: 'manual',
      name: `Manual Device (${input.address})`,
      protocol: 'zeroconf',
      secondaryProtocols: [],
      status: 'discovered',
      authenticated: false,
      addresses: [input.address],
      port: input.port,
      durableIdentities: [{ kind: 'net', value: `net:${input.address}:${input.port ?? 80}` }],
      details: { manualFallback: true },
      discoveredAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result: HandoverResult = {
      address: input.address,
      port: input.port,
      candidate: syntheticCandidate,
      addressChanged: true,
      manualFallback: true,
    };

    entry.resolve(result);
    return result;
  }

  cancel(commissioningId: string): boolean {
    const entry = this.pending.get(commissioningId);
    if (!entry) return false;
    this.pending.delete(commissioningId);
    entry.reject(new Error('handover_cancelled'));
    return true;
  }

  isWaiting(commissioningId: string): boolean {
    return this.pending.has(commissioningId);
  }

  getCriteria(commissioningId: string): HandoverCriteria | undefined {
    return this.pending.get(commissioningId)?.criteria;
  }
}
