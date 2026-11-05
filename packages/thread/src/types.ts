/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type ThreadNodeRole = 'leader' | 'router' | 'child' | 'detached' | 'disabled';

export interface ThreadDataset {
  readonly networkName: string;
  readonly channel: number; // 11-26
  readonly panId: number; // 16-bit uint
  readonly extendedPanId: string; // 16-hex characters
  readonly networkKey: string; // 32-hex characters (128-bit)
  readonly meshLocalPrefix: string; // IPv6 prefix e.g. 'fd00:7d03:7d03::/64'
  readonly pskc?: string; // Pre-shared Key for Commissioner
  readonly channelMask?: number;
}

export interface ThreadNeighbor {
  readonly rloc16: string;
  readonly extAddress: string;
  readonly lqi: number; // 0-255
  readonly averageRssi?: number;
  readonly isChild: boolean;
  readonly age: number;
}

export interface ThreadNetworkState {
  readonly role: ThreadNodeRole;
  readonly rloc16?: string;
  readonly extAddress?: string;
  readonly partitionId?: number;
  readonly routerId?: number;
  readonly activeDataset?: ThreadDataset;
  readonly neighborCount: number;
}
