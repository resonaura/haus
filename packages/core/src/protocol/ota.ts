/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { sha256 } from './sha256.js';

export type OtaSessionState =
  'idle' | 'negotiating' | 'transferring' | 'verifying' | 'completed' | 'failed' | 'aborted';

export interface OtaFirmwareImage {
  readonly manufacturerCode: number;
  readonly imageType: number;
  readonly fileVersion: number;
  readonly totalSize: number;
  readonly sha256: string;
  readonly data: Uint8Array;
}

export interface OtaChunk {
  readonly offset: number;
  readonly size: number;
  readonly data: Uint8Array;
}

export class OtaTransferSession {
  public readonly targetDeviceId: string;
  public readonly image: OtaFirmwareImage;
  public readonly chunkSize: number;

  private _state: OtaSessionState = 'idle';
  private _offset = 0;
  private _acknowledgedOffset = 0;
  private _error?: string;

  public constructor(
    targetDeviceId: string,
    image: OtaFirmwareImage,
    options: { chunkSize?: number; resumeOffset?: number } = {},
  ) {
    this.targetDeviceId = targetDeviceId;
    this.image = image;
    this.chunkSize = options.chunkSize ?? 64;
    const initialOffset = options.resumeOffset ?? 0;
    if (initialOffset > 0 && initialOffset < image.totalSize) {
      this._offset = initialOffset;
      this._acknowledgedOffset = initialOffset;
    }
  }

  public get state(): OtaSessionState {
    return this._state;
  }

  public get currentOffset(): number {
    return this._offset;
  }

  public get acknowledgedOffset(): number {
    return this._acknowledgedOffset;
  }

  public get progressPercentage(): number {
    if (this.image.totalSize === 0) return 100;
    return Math.min(100, Math.floor((this._acknowledgedOffset / this.image.totalSize) * 100));
  }

  public get error(): string | undefined {
    return this._error;
  }

  public start(): void {
    if (this._state !== 'idle') {
      throw new Error(`Cannot start OTA session from state '${this._state}'`);
    }
    this._state = 'transferring';
  }

  public getNextChunk(): OtaChunk | null {
    if (this._state !== 'transferring') return null;
    if (this._offset >= this.image.totalSize) {
      this._state = 'verifying';
      return null;
    }

    const end = Math.min(this._offset + this.chunkSize, this.image.totalSize);
    const chunkData = this.image.data.subarray(this._offset, end);
    const chunk: OtaChunk = {
      offset: this._offset,
      size: chunkData.length,
      data: chunkData,
    };
    this._offset = end;
    return chunk;
  }

  public acknowledgeChunk(offset: number, size: number): void {
    if (offset + size > this._acknowledgedOffset) {
      this._acknowledgedOffset = offset + size;
    }
    if (this._acknowledgedOffset >= this.image.totalSize && this._state === 'transferring') {
      this._state = 'verifying';
    }
  }

  public verifyIntegrity(): boolean {
    if (this._state !== 'verifying' && this._state !== 'transferring') {
      return false;
    }
    const computedHash = sha256(this.image.data);
    const valid = computedHash.toLowerCase() === this.image.sha256.toLowerCase();
    if (valid) {
      this._state = 'completed';
    } else {
      this._state = 'failed';
      this._error = `OTA integrity mismatch: expected ${this.image.sha256}, got ${computedHash}`;
    }
    return valid;
  }

  public abort(reason: string): void {
    this._state = 'aborted';
    this._error = reason;
  }
}
