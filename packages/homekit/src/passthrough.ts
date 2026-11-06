/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/**
 * Raw HAP Characteristic data structure preserving complete inbound protocol metadata.
 * Unconsumed or vendor-specific UUIDs and TLV8 structures are retained without truncation.
 */
export interface RawHapCharacteristic {
  readonly iid: number;
  readonly type: string;
  readonly value?: unknown;
  readonly perms: readonly string[];
  readonly format?: string;
  readonly unit?: string;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly minStep?: number;
  readonly maxLen?: number;
  readonly maxDataLen?: number;
  readonly validValues?: readonly number[];
  readonly validValuesRange?: readonly [number, number];
  readonly description?: string;
  readonly rawMetadata?: Readonly<Record<string, unknown>>;
}

/**
 * Raw HAP Service data structure preserving type UUID and linked service relationships.
 */
export interface RawHapService {
  readonly iid: number;
  readonly type: string;
  readonly primary?: boolean;
  readonly hidden?: boolean;
  readonly linked?: readonly number[];
  readonly characteristics: readonly RawHapCharacteristic[];
}

/**
 * Raw HAP Accessory data structure corresponding to GET /accessories.
 */
export interface RawHapAccessory {
  readonly aid: number;
  readonly services: readonly RawHapService[];
}

export interface RawHapAccessoriesResponse {
  readonly accessories: readonly RawHapAccessory[];
}

/**
 * Publication policy options determining how an accessory or device profile is exposed.
 */
export type HapPublicationPolicy =
  | 'STANDARD_BRIDGE'
  | 'ISOLATED_ACCESSORY'
  | 'CAMERA_ACCESSORY'
  | 'TV_ACCESSORY'
  | 'HOMEKEY_ACCESSORY'
  | 'ROUTER_ACCESSORY'
  | 'MATTER_AGGREGATOR_ENDPOINT';

/**
 * Exporter policies for Generic characteristics.
 */
export type HapExporterPolicy = 'native-only' | 'custom-hap' | 'compatibility-projection';

export interface UpstreamHapRef {
  readonly accessoryId: string;
  readonly upstreamAid: number;
  readonly upstreamIid: number;
}

export interface DownstreamHapRef {
  readonly outboundAid: number;
  readonly outboundIid: number;
}

/**
 * Persistent identity mapper translating upstream accessory AID/IID
 * to downstream outbound HAP server AID/IID.
 */
export class HapProxyIdentityMapper {
  private readonly upstreamToOutbound = new Map<string, DownstreamHapRef>();
  private readonly outboundToUpstream = new Map<string, UpstreamHapRef>();

  private makeUpstreamKey(ref: UpstreamHapRef): string {
    return `${ref.accessoryId}:${ref.upstreamAid}:${ref.upstreamIid}`;
  }

  private makeOutboundKey(aid: number, iid: number): string {
    return `${aid}:${iid}`;
  }

  public bindIdentity(upstream: UpstreamHapRef, outbound: DownstreamHapRef): void {
    const upKey = this.makeUpstreamKey(upstream);
    const outKey = this.makeOutboundKey(outbound.outboundAid, outbound.outboundIid);
    this.upstreamToOutbound.set(upKey, outbound);
    this.outboundToUpstream.set(outKey, upstream);
  }

  public getOutbound(upstream: UpstreamHapRef): DownstreamHapRef | undefined {
    return this.upstreamToOutbound.get(this.makeUpstreamKey(upstream));
  }

  public getUpstream(aid: number, iid: number): UpstreamHapRef | undefined {
    return this.outboundToUpstream.get(this.makeOutboundKey(aid, iid));
  }

  public clear(): void {
    this.upstreamToOutbound.clear();
    this.outboundToUpstream.clear();
  }
}

export interface PassthroughSession {
  readonly sessionId: string;
  readonly accessoryId: string;
  readonly clientIp: string;
  readonly state: 'handshake' | 'active' | 'closed';
  readonly lastActive: number;
}

export interface InterceptedCharacteristicUpdate {
  readonly aid: number;
  readonly iid: number;
  readonly value: unknown;
}

/**
 * Lossless Application-Semantic Proxy for HomeKit Accessory Protocol.
 *
 * NOTE: Haus terminates separate HAP security sessions (Pair Setup, Pair Verify,
 * session encryption) on each side and operates as an application-semantic proxy
 * rather than a cryptographically transparent TCP proxy. It retains every source
 * service UUID, characteristic UUID, metadata field, permissions, and unknown TLV8 payload.
 */
export class HAPassThrough {
  private readonly sessions = new Map<string, PassthroughSession>();
  private readonly updateListeners = new Set<(update: InterceptedCharacteristicUpdate) => void>();
  public readonly identityMapper = new HapProxyIdentityMapper();

  public openSession(sessionId: string, accessoryId: string, clientIp: string): PassthroughSession {
    const session: PassthroughSession = {
      sessionId,
      accessoryId,
      clientIp,
      state: 'handshake',
      lastActive: Date.now(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  public activateSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.sessions.set(sessionId, {
      ...session,
      state: 'active',
      lastActive: Date.now(),
    });
    return true;
  }

  public closeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  public getSession(sessionId: string): PassthroughSession | undefined {
    return this.sessions.get(sessionId);
  }

  public onCharacteristicUpdate(
    callback: (update: InterceptedCharacteristicUpdate) => void,
  ): () => void {
    this.updateListeners.add(callback);
    return () => this.updateListeners.delete(callback);
  }

  /**
   * Intercepts and terminates characteristic writes in transit.
   */
  public interceptWritePayload(sessionId: string, payload: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== 'active') return;

    if (
      payload &&
      typeof payload === 'object' &&
      'characteristics' in payload &&
      Array.isArray((payload as { characteristics: unknown[] }).characteristics)
    ) {
      for (const item of (payload as { characteristics: unknown[] }).characteristics) {
        if (item && typeof item === 'object' && 'aid' in item && 'iid' in item && 'value' in item) {
          const update = item as InterceptedCharacteristicUpdate;
          for (const listener of this.updateListeners) {
            try {
              listener(update);
            } catch {}
          }
        }
      }
    }
  }
}
