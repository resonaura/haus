/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  Advertisement,
  RadioAgent,
  RadioAgentPlatform,
  RadioConnection,
  RadioDevice,
  ScanRequest,
} from './types.js';

export interface RadioAgentCapabilities {
  readonly bleScan?: boolean;
  readonly bleConnect?: boolean;
  readonly softApScan?: boolean;
  readonly softApConnect?: boolean;
  readonly rssiReporting?: boolean;
}

export interface RadioAgentDescriptor {
  readonly id: string;
  readonly name: string;
  readonly platform: RadioAgentPlatform;
  readonly capabilities: RadioAgentCapabilities;
  readonly homeId: string;
  readonly registeredAt: number;
  readonly lastSeenAt: number;
  readonly status: 'online' | 'busy' | 'offline';
}

export interface RadioAgentSessionLease {
  readonly leaseId: string;
  readonly leaseToken: string;
  readonly agentId: string;
  readonly commissioningId: string;
  readonly homeId: string;
  readonly grantedAt: number;
  readonly expiresAt: number;
  readonly revoked: boolean;
  readonly permittedTransports: readonly ('ble' | 'softap')[];
}

export function isLeaseValid(
  lease?: RadioAgentSessionLease,
  commissioningId?: string,
  homeId?: string,
  now = Date.now(),
): boolean {
  if (!lease) return false;
  if (lease.revoked) return false;
  if (now > lease.expiresAt) return false;
  if (commissioningId && lease.commissioningId !== commissioningId) return false;
  if (homeId && lease.homeId !== homeId) return false;
  return true;
}

export type RadioRpcMessageType =
  | 'scan.start'
  | 'scan.stop'
  | 'scan.adv'
  | 'scan.complete'
  | 'conn.open'
  | 'conn.ack'
  | 'conn.close'
  | 'conn.closed'
  | 'gatt.read'
  | 'gatt.read.ack'
  | 'gatt.write'
  | 'gatt.write.ack'
  | 'gatt.sub'
  | 'gatt.sub.ack'
  | 'gatt.unsub'
  | 'gatt.notify'
  | 'heartbeat.ping'
  | 'heartbeat.pong'
  | 'rpc.error';

export interface RadioRpcMessage<T = unknown> {
  readonly id: string;
  readonly corrId?: string;
  readonly type: RadioRpcMessageType;
  readonly leaseToken?: string;
  readonly timestamp: number;
  readonly payload?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export function sanitizeRadioRpcError(err: unknown): { code: string; message: string } {
  if (!err) return { code: 'unknown_error', message: 'Unknown RPC error' };
  const rawMsg = err instanceof Error ? err.message : String(err);
  let cleaned = rawMsg
    .replace(/\b\d{3}-\d{2}-\d{3}\b/g, '[REDACTED_PIN]')
    .replace(/\b\d{8}\b/g, '[REDACTED_CODE]')
    .replace(/\bMT:[A-Z0-9.-]+\b/g, '[REDACTED_QR]')
    .replace(/(?:password|token|bearer|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
  if (cleaned.length > 200) cleaned = `${cleaned.slice(0, 197)}...`;
  const code =
    err instanceof Error && 'code' in err && typeof err.code === 'string'
      ? err.code
      : cleaned.toLowerCase().includes('timeout')
        ? 'rpc_timeout'
        : cleaned.toLowerCase().includes('overflow')
          ? 'queue_overflow'
          : cleaned.toLowerCase().includes('lease')
            ? 'agent_lease_expired'
            : cleaned.toLowerCase().includes('disconnect')
              ? 'radio_disconnected'
              : 'radio_rpc_error';
  return { code, message: cleaned };
}

interface PendingRequest {
  readonly id: string;
  readonly resolve: (msg: RadioRpcMessage) => void;
  readonly reject: (err: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class BoundedRpcQueue {
  private readonly pending = new Map<string, PendingRequest>();
  private closed = false;

  constructor(
    public readonly maxCapacity = 100,
    public readonly timeoutMs = 10_000,
  ) {}

  async request(
    msg: RadioRpcMessage,
    send: (m: RadioRpcMessage) => Promise<void> | void,
  ): Promise<RadioRpcMessage> {
    if (this.closed) throw new Error('queue_closed');
    if (this.pending.size >= this.maxCapacity) throw new Error('queue_overflow');

    return new Promise<RadioRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msg.id);
        reject(new Error('rpc_timeout'));
      }, this.timeoutMs);

      this.pending.set(msg.id, { id: msg.id, resolve, reject, timer });
      try {
        const res = send(msg);
        if (res instanceof Promise) {
          res.catch((err: unknown) => {
            clearTimeout(timer);
            this.pending.delete(msg.id);
            reject(err instanceof Error ? err : new Error(String(err)));
          });
        }
      } catch (err: unknown) {
        clearTimeout(timer);
        this.pending.delete(msg.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  handleResponse(msg: RadioRpcMessage): boolean {
    const corr = msg.corrId ?? msg.id;
    const req = this.pending.get(corr);
    if (!req) return false;
    clearTimeout(req.timer);
    this.pending.delete(corr);

    if (msg.type === 'rpc.error' || msg.error) {
      const err = new Error(msg.error?.message ?? 'remote_rpc_error');
      Object.assign(err, { code: msg.error?.code ?? 'remote_rpc_error' });
      req.reject(err);
    } else {
      req.resolve(msg);
    }
    return true;
  }

  close(reason = 'queue_closed'): void {
    this.closed = true;
    for (const req of this.pending.values()) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

export class RemoteRadioAgentProxy implements RadioAgent {
  public readonly id: string;
  public readonly platform: RadioAgentPlatform;
  private readonly queue: BoundedRpcQueue;
  private activeLease?: RadioAgentSessionLease;
  private readonly scanListeners = new Set<(adv: Advertisement) => void>();
  private readonly notifyListeners = new Map<string, Set<(data: Uint8Array) => void>>();
  private readonly closeListeners = new Set<() => void>();

  constructor(
    public readonly descriptor: RadioAgentDescriptor,
    private readonly sendRpcFn: (msg: RadioRpcMessage) => Promise<void> | void,
    options?: {
      lease?: RadioAgentSessionLease;
      maxQueueSize?: number;
      rpcTimeoutMs?: number;
    },
  ) {
    this.id = descriptor.id;
    this.platform = descriptor.platform;
    this.activeLease = options?.lease;
    this.queue = new BoundedRpcQueue(options?.maxQueueSize ?? 100, options?.rpcTimeoutMs ?? 10_000);
  }

  setLease(lease: RadioAgentSessionLease): void {
    this.activeLease = lease;
  }

  getLease(): RadioAgentSessionLease | undefined {
    return this.activeLease;
  }

  handleIncomingRpc(msg: RadioRpcMessage): void {
    if (msg.type === 'scan.adv' && msg.payload) {
      const adv = msg.payload as Advertisement;
      for (const listener of this.scanListeners) {
        listener(adv);
      }
      return;
    }
    if (msg.type === 'gatt.notify' && msg.payload) {
      const p = msg.payload as { service: string; characteristic: string; data: number[] };
      const key = `${p.service.toLowerCase()}:${p.characteristic.toLowerCase()}`;
      const listeners = this.notifyListeners.get(key);
      if (listeners) {
        const bytes = new Uint8Array(p.data);
        for (const l of listeners) l(bytes);
      }
      return;
    }
    if (msg.type === 'conn.closed') {
      for (const cl of this.closeListeners) cl();
      return;
    }
    this.queue.handleResponse(msg);
  }

  async *scan(request: ScanRequest): AsyncIterable<Advertisement> {
    if (!isLeaseValid(this.activeLease, request.commissioningId)) {
      throw new Error('agent_lease_expired');
    }
    if (this.descriptor.capabilities.bleScan === false) {
      throw new Error('agent_capability_unsupported');
    }

    const startMsg: RadioRpcMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'scan.start',
      leaseToken: this.activeLease?.leaseToken,
      timestamp: Date.now(),
      payload: request,
    };

    const buffer: Advertisement[] = [];
    let notifyResolver: (() => void) | undefined;
    let completed = false;

    const onAdv = (adv: Advertisement): void => {
      buffer.push(adv);
      notifyResolver?.();
    };

    this.scanListeners.add(onAdv);
    try {
      await this.queue.request(startMsg, (m) => this.sendRpcFn(m));
      const deadline = Date.now() + (request.timeoutMs ?? 15_000);

      while (!completed && Date.now() < deadline) {
        if (buffer.length > 0) {
          const next = buffer.shift();
          if (next) yield next;
        } else {
          await new Promise<void>((resolve) => {
            notifyResolver = resolve;
            const remaining = Math.max(10, deadline - Date.now());
            const timer = setTimeout(resolve, Math.min(remaining, 500));
            notifyResolver = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
      }
    } finally {
      completed = true;
      this.scanListeners.delete(onAdv);
      const stopMsg: RadioRpcMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'scan.stop',
        leaseToken: this.activeLease?.leaseToken,
        timestamp: Date.now(),
        payload: { commissioningId: request.commissioningId },
      };
      void Promise.resolve(this.sendRpcFn(stopMsg)).catch(() => undefined);
    }
  }

  async connect(device: RadioDevice): Promise<RadioConnection> {
    if (!isLeaseValid(this.activeLease)) {
      throw new Error('agent_lease_expired');
    }
    if (this.descriptor.capabilities.bleConnect === false) {
      throw new Error('agent_capability_unsupported');
    }

    const connectMsg: RadioRpcMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'conn.open',
      leaseToken: this.activeLease?.leaseToken,
      timestamp: Date.now(),
      payload: device,
    };

    const ack = await this.queue.request(connectMsg, (m) => this.sendRpcFn(m));
    if (ack.error) {
      throw new Error(ack.error.message);
    }

    let isClosed = false;
    const onClose = (): void => {
      isClosed = true;
    };
    this.closeListeners.add(onClose);

    return {
      device,
      writeCharacteristic: async (
        serviceUuid: string,
        characteristicUuid: string,
        data: Uint8Array,
      ): Promise<void> => {
        if (isClosed) throw new Error('radio_disconnected');
        if (!isLeaseValid(this.activeLease)) throw new Error('agent_lease_expired');
        const writeMsg: RadioRpcMessage = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'gatt.write',
          leaseToken: this.activeLease?.leaseToken,
          timestamp: Date.now(),
          payload: {
            service: serviceUuid,
            characteristic: characteristicUuid,
            data: Array.from(data),
          },
        };
        await this.queue.request(writeMsg, (m) => this.sendRpcFn(m));
      },
      readCharacteristic: async (
        serviceUuid: string,
        characteristicUuid: string,
      ): Promise<Uint8Array> => {
        if (isClosed) throw new Error('radio_disconnected');
        if (!isLeaseValid(this.activeLease)) throw new Error('agent_lease_expired');
        const readMsg: RadioRpcMessage = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'gatt.read',
          leaseToken: this.activeLease?.leaseToken,
          timestamp: Date.now(),
          payload: { service: serviceUuid, characteristic: characteristicUuid },
        };
        const res = await this.queue.request(readMsg, (m) => this.sendRpcFn(m));
        const bytes = (res.payload as { data?: number[] })?.data ?? [];
        return new Uint8Array(bytes);
      },
      subscribeCharacteristic: async (
        serviceUuid: string,
        characteristicUuid: string,
        listener: (data: Uint8Array) => void,
      ): Promise<() => void> => {
        if (isClosed) throw new Error('radio_disconnected');
        if (!isLeaseValid(this.activeLease)) throw new Error('agent_lease_expired');
        const key = `${serviceUuid.toLowerCase()}:${characteristicUuid.toLowerCase()}`;
        let set = this.notifyListeners.get(key);
        if (!set) {
          set = new Set();
          this.notifyListeners.set(key, set);
        }
        set.add(listener);

        const subMsg: RadioRpcMessage = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'gatt.sub',
          leaseToken: this.activeLease?.leaseToken,
          timestamp: Date.now(),
          payload: { service: serviceUuid, characteristic: characteristicUuid },
        };
        await this.queue.request(subMsg, (m) => this.sendRpcFn(m));

        return () => {
          set?.delete(listener);
          if (set?.size === 0) {
            this.notifyListeners.delete(key);
            const unsubMsg: RadioRpcMessage = {
              id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'gatt.unsub',
              leaseToken: this.activeLease?.leaseToken,
              timestamp: Date.now(),
              payload: { service: serviceUuid, characteristic: characteristicUuid },
            };
            void Promise.resolve(this.sendRpcFn(unsubMsg)).catch(() => undefined);
          }
        };
      },
      close: async (): Promise<void> => {
        if (isClosed) return;
        isClosed = true;
        this.closeListeners.delete(onClose);
        const closeMsg: RadioRpcMessage = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'conn.close',
          leaseToken: this.activeLease?.leaseToken,
          timestamp: Date.now(),
          payload: device,
        };
        await Promise.resolve(this.sendRpcFn(closeMsg)).catch(() => undefined);
      },
    };
  }

  disconnect(reason = 'radio_disconnected'): void {
    this.queue.close(reason);
    for (const cl of this.closeListeners) cl();
    this.closeListeners.clear();
    this.scanListeners.clear();
    this.notifyListeners.clear();
  }
}
