/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { ThreadDataset, ThreadNeighbor, ThreadNetworkState } from './types.js';
import { validateThreadDataset } from './dataset.js';

export interface ThreadTransport {
  setActiveDataset(dataset: ThreadDataset): Promise<void>;
  getActiveDataset(): Promise<ThreadDataset>;
  attach(): Promise<void>;
  detach(): Promise<void>;
  getState(): Promise<ThreadNetworkState>;
  getNeighbors(): Promise<readonly ThreadNeighbor[]>;
  commission(eui64: string, pskd: string): Promise<void>;
}

/**
 * Haus-native Thread mesh network controller.
 * Manages operational datasets, Thread border routing, commissioning, and mesh topology.
 */
export class ThreadController {
  constructor(private readonly transport: ThreadTransport) {}

  async formNetwork(dataset: ThreadDataset): Promise<void> {
    const validation = validateThreadDataset(dataset);
    if (!validation.valid || !validation.dataset) {
      throw new Error(`invalid_thread_dataset: ${validation.errors.join('; ')}`);
    }

    await this.transport.setActiveDataset(validation.dataset);
    await this.transport.attach();
  }

  async joinNetwork(dataset: ThreadDataset): Promise<void> {
    const validation = validateThreadDataset(dataset);
    if (!validation.valid || !validation.dataset) {
      throw new Error(`invalid_thread_dataset: ${validation.errors.join('; ')}`);
    }

    await this.transport.setActiveDataset(validation.dataset);
    await this.transport.attach();
  }

  async leaveNetwork(): Promise<void> {
    await this.transport.detach();
  }

  async getActiveDataset(): Promise<ThreadDataset> {
    return this.transport.getActiveDataset();
  }

  async getNetworkState(): Promise<ThreadNetworkState> {
    return this.transport.getState();
  }

  async listNeighbors(): Promise<readonly ThreadNeighbor[]> {
    return this.transport.getNeighbors();
  }

  async commissionDevice(eui64: string, pskd: string): Promise<void> {
    if (!/^[a-fA-F0-9]{16}$/.test(eui64)) {
      throw new Error('invalid_eui64_identifier');
    }
    if (!pskd || pskd.trim().length === 0) {
      throw new Error('invalid_pskd_passphrase');
    }

    await this.transport.commission(eui64, pskd);
  }
}
