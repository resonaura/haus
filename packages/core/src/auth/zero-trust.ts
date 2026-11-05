/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { timingSafeStringEqual } from '../pairing/pairing.js';
import { sha256 } from '../protocol/sha256.js';

export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRequest {
  readonly id: string;
  readonly hubId: string;
  readonly clientName: string;
  readonly clientIp: string;
  readonly deviceType: string;
  readonly verificationCode: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly status: ApprovalRequestStatus;
}

export function generate4DigitCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function randomHex(bytesCount: number): string {
  let hex = '';
  for (let i = 0; i < bytesCount; i++) {
    const byte = Math.floor(Math.random() * 256);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function generateBackupCode(): string {
  const hex = randomHex(6).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(generateBackupCode());
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  const normalized = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return sha256(normalized);
}

export function verifyAndConsumeBackupCode(
  rawCode: string,
  storedHashes: readonly string[],
): { valid: boolean; remainingHashes: string[] } {
  const targetHash = hashBackupCode(rawCode);
  const index = storedHashes.findIndex((h) => timingSafeStringEqual(h, targetHash));
  if (index === -1) {
    return { valid: false, remainingHashes: [...storedHashes] };
  }

  const remainingHashes = [...storedHashes];
  remainingHashes.splice(index, 1);
  return { valid: true, remainingHashes };
}

export class ZeroTrustApprovalManager {
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly defaultTtlMs: number;

  public constructor(options: { defaultTtlMs?: number } = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 5 * 60 * 1000; // 5 minutes
  }

  public createRequest(params: {
    hubId: string;
    clientName: string;
    clientIp: string;
    deviceType: string;
    ttlMs?: number;
  }): ApprovalRequest {
    const id = `req-${randomHex(8)}`;
    const now = Date.now();
    const ttl = params.ttlMs ?? this.defaultTtlMs;
    const request: ApprovalRequest = {
      id,
      hubId: params.hubId,
      clientName: params.clientName,
      clientIp: params.clientIp,
      deviceType: params.deviceType,
      verificationCode: generate4DigitCode(),
      createdAt: now,
      expiresAt: now + ttl,
      status: 'pending',
    };
    this.requests.set(id, request);
    return request;
  }

  public getRequest(id: string): ApprovalRequest | undefined {
    const req = this.requests.get(id);
    if (!req) return undefined;
    if (req.status === 'pending' && Date.now() > req.expiresAt) {
      const expired: ApprovalRequest = { ...req, status: 'expired' };
      this.requests.set(id, expired);
      return expired;
    }
    return req;
  }

  public isPending(id: string): boolean {
    const req = this.getRequest(id);
    return req?.status === 'pending';
  }

  public approveRequest(id: string, verificationCode: string): boolean {
    const req = this.getRequest(id);
    if (!req || req.status !== 'pending') return false;

    if (!timingSafeStringEqual(req.verificationCode, verificationCode.trim())) {
      return false;
    }

    this.requests.set(id, { ...req, status: 'approved' });
    return true;
  }

  public rejectRequest(id: string): boolean {
    const req = this.getRequest(id);
    if (!req || req.status !== 'pending') return false;

    this.requests.set(id, { ...req, status: 'rejected' });
    return true;
  }

  public purgeExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, req] of this.requests.entries()) {
      if (req.expiresAt < now) {
        this.requests.delete(id);
        count++;
      }
    }
    return count;
  }
}
