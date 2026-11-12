/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { BridgeInventory } from '@haus/bridge/protocol';
import type { IdentityRow, AliasRow, AddressRow } from '../../storage/entities/types.js';
import type { StandaloneHomeEntryRow } from '../../storage/standalone/entities.js';
import type { CameraIdentityRow, CameraSourceRow } from '../../storage/cameras/entities.js';

export interface CameraMigrationEvidence {
  readonly homeId: string;
  readonly inventory: BridgeInventory;
  /** An explicitly verified bridge relocation, not discovery or display-name evidence. */
  readonly move: { readonly fromHost: string; readonly toHost: string };
  readonly assignments: readonly {
    readonly cameraId: string;
    readonly source: { readonly kind: string; readonly url: string };
  }[];
}
export interface CameraMigrationSnapshot {
  readonly home: readonly StandaloneHomeEntryRow[];
  readonly identities: readonly IdentityRow[];
  readonly aliases: readonly AliasRow[];
  readonly native: readonly CameraIdentityRow[];
  readonly sources: readonly CameraSourceRow[];
  readonly addresses: readonly AddressRow[];
  readonly primary: readonly AddressRow[];
}
export interface Mutation<T> {
  readonly before?: T;
  readonly after?: T;
}
/** Narrow stored fields used by the migrator; opaque catalog properties are preserved verbatim. */
export interface StoredReference extends Readonly<Record<string, unknown>> {
  readonly protocol: string;
  readonly externalId: string;
  readonly domain?: string;
}
export interface StoredEndpoint extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly (Readonly<Record<string, unknown>> & { readonly id: string })[];
  readonly sourceRefs?: readonly StoredReference[];
}
export interface StoredDevice extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly name: string;
  readonly source: Readonly<Record<string, unknown>> & {
    readonly instanceId: string;
    readonly externalId: string;
  };
  readonly sourceRefs?: readonly StoredReference[];
  readonly endpoints: readonly StoredEndpoint[];
}
export interface CameraGraphMigration {
  readonly device: StoredDevice;
  readonly redirects: ReadonlyMap<string, string>;
  readonly stateRedirects: ReadonlyMap<string, string>;
  readonly removed: ReadonlySet<string>;
  readonly deviceIds: readonly string[];
}
export interface CameraMigrationPlan {
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly changes: {
    readonly home: readonly Mutation<StandaloneHomeEntryRow>[];
    readonly identities: readonly Mutation<IdentityRow>[];
    readonly aliases: readonly Mutation<AliasRow>[];
    readonly native: readonly Mutation<CameraIdentityRow>[];
  };
  readonly cameras: readonly {
    readonly physicalId: string;
    readonly deviceId: string;
    readonly cameraId: string;
  }[];
}
