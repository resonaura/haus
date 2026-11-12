/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { MatterAttributeChange, MatterCommissioningParams, MatterNodeId } from './types.js';
import type { MatterTransport } from './controller.js';

export interface MatterWsTransportOptions {
  readonly url: string;
  readonly reconnectIntervalMs?: number;
}

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class MatterWsTransport implements MatterTransport {
  private ws?: WebSocket;
  private messageSeq = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscribers = new Set<(change: MatterAttributeChange) => void>();
  private closed = false;
  private connectPromise?: Promise<void>;

  constructor(private readonly options: MatterWsTransportOptions) {}

  public async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.closed = false;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      let handshakeDone = false;
      const ws = new WebSocket(this.options.url);
      this.ws = ws;

      const connectionTimeout = setTimeout(() => {
        if (!handshakeDone) {
          ws.close();
          reject(new Error('matter_ws_connection_timeout'));
        }
      }, 10_000);

      ws.onopen = () => {
        // Wait for initial server handshake message before declaring ready
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : String(event.data);
          const msg = JSON.parse(raw) as Record<string, unknown>;

          if (!handshakeDone && msg.sdk_version !== undefined) {
            handshakeDone = true;
            clearTimeout(connectionTimeout);
            resolve();
            return;
          }

          this.handleIncoming(msg);
        } catch {
          // Ignore unparseable frames
        }
      };

      ws.onerror = (err) => {
        if (!handshakeDone) {
          clearTimeout(connectionTimeout);
          reject(new Error(`matter_ws_error: ${String(err)}`));
        }
      };

      ws.onclose = () => {
        clearTimeout(connectionTimeout);
        this.ws = undefined;
        this.connectPromise = undefined;
        this.flushPending(new Error('matter_ws_closed'));
        if (!this.closed && !handshakeDone) {
          reject(new Error('matter_ws_closed_before_ready'));
        }
      };
    });

    return this.connectPromise;
  }

  public close(): void {
    this.closed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.connectPromise = undefined;
    this.flushPending(new Error('matter_ws_closed'));
    this.subscribers.clear();
  }

  public subscribe(callback: (change: MatterAttributeChange) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  public async getNodes(): Promise<unknown[]> {
    const res = await this.sendRequest('get_nodes');
    return Array.isArray(res) ? res : [];
  }

  public async getNode(nodeId: MatterNodeId): Promise<unknown> {
    return this.sendRequest('get_node', { node_id: Number(nodeId) });
  }

  public async commission(
    params: MatterCommissioningParams,
  ): Promise<{ nodeId: MatterNodeId; fabricIndex: number }> {
    if (params.wifiSsid && params.wifiPassword) {
      await this.setWifiCredentials(params.wifiSsid, params.wifiPassword);
    }
    if (params.threadDataset) {
      await this.setThreadDataset(params.threadDataset);
    }

    const payload: Record<string, unknown> = {
      code: params.code,
    };
    if (params.ip) {
      payload.network_only = true;
      payload.ip_addr = params.ip;
      payload.port = params.port ?? 5540;
    }
    if (params.failSafeTimeoutSeconds) {
      payload.failsafe_timeout = params.failSafeTimeoutSeconds;
    }

    const res = (await this.sendRequest('commission_with_code', payload)) as {
      node_id?: number;
      fabric_index?: number;
    };

    return {
      nodeId: String(res?.node_id ?? 0),
      fabricIndex: res?.fabric_index ?? 1,
    };
  }

  public async setWifiCredentials(ssid: string, credentials: string): Promise<void> {
    await this.sendRequest('set_wifi_credentials', { ssid, credentials });
  }

  public async setThreadDataset(dataset: string | Uint8Array): Promise<void> {
    const raw = typeof dataset === 'string' ? dataset : Buffer.from(dataset).toString('hex');
    await this.sendRequest('set_thread_dataset', { dataset: raw });
  }

  public async sendCommand(
    nodeId: MatterNodeId,
    endpointId: number,
    clusterId: number,
    commandId: number,
    payload?: unknown,
  ): Promise<unknown> {
    const commandName = this.resolveCommandName(clusterId, commandId);
    return this.sendRequest('device_command', {
      node_id: Number(nodeId),
      endpoint_id: endpointId,
      cluster_id: clusterId,
      command_name: commandName,
      payload: (payload as Record<string, unknown>) ?? {},
    });
  }

  public async readAttribute(
    nodeId: MatterNodeId,
    endpointId: number,
    clusterId: number,
    attributeId: number,
  ): Promise<unknown> {
    return this.sendRequest('read_attribute', {
      node_id: Number(nodeId),
      attribute_path: `${endpointId}/${clusterId}/${attributeId}`,
    });
  }

  public async writeAttribute(
    nodeId: MatterNodeId,
    endpointId: number,
    clusterId: number,
    attributeId: number,
    value: unknown,
  ): Promise<void> {
    await this.sendRequest('write_attribute', {
      node_id: Number(nodeId),
      attribute_path: `${endpointId}/${clusterId}/${attributeId}`,
      value,
    });
  }

  private async sendRequest(command: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const messageId = `m-${++this.messageSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new Error(`matter_request_timeout: ${command}`));
      }, 15_000);

      this.pending.set(messageId, { resolve, reject, timer });

      const payload = JSON.stringify({
        message_id: messageId,
        command,
        args: args ?? {},
      });

      this.ws?.send(payload);
    });
  }

  private handleIncoming(msg: Record<string, unknown>): void {
    // 1. Result message
    if (typeof msg.message_id === 'string' && this.pending.has(msg.message_id)) {
      const req = this.pending.get(msg.message_id);
      this.pending.delete(msg.message_id);
      if (req) {
        clearTimeout(req.timer);
        if (msg.error_code !== undefined && msg.error_code !== null) {
          req.reject(
            new Error(`matter_error_${String(msg.error_code)}: ${String(msg.details ?? '')}`),
          );
        } else {
          req.resolve(msg.result);
        }
      }
      return;
    }

    // 2. Event message
    if (msg.event === 'attribute_updated' && Array.isArray(msg.data) && msg.data.length >= 3) {
      const [nodeIdRaw, pathRaw, newValue] = msg.data;
      const pathParts = String(pathRaw).split('/');
      if (pathParts.length >= 3) {
        const change: MatterAttributeChange = {
          nodeId: String(nodeIdRaw),
          endpointId: Number.parseInt(pathParts[0], 10),
          clusterId: Number.parseInt(pathParts[1], 10),
          attributeId: Number.parseInt(pathParts[2], 10),
          value: newValue,
          timestamp: Date.now(),
        };
        for (const sub of this.subscribers) {
          try {
            sub(change);
          } catch {
            // Protect dispatch loop
          }
        }
      }
    }
  }

  private flushPending(err: Error): void {
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(err);
    }
    this.pending.clear();
  }

  private resolveCommandName(clusterId: number, commandId: number): string {
    // OnOff cluster (0x0006)
    if (clusterId === 6) {
      if (commandId === 0) return 'Off';
      if (commandId === 1) return 'On';
      if (commandId === 2) return 'Toggle';
    }
    // LevelControl cluster (0x0008)
    if (clusterId === 8) {
      if (commandId === 0) return 'MoveToLevel';
      if (commandId === 4) return 'MoveToLevelWithOnOff';
    }
    // Identify cluster (0x0003)
    if (clusterId === 3) {
      if (commandId === 0) return 'Identify';
    }
    return `Command_${commandId}`;
  }
}
