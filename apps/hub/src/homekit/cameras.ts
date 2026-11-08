/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HomeKitCameras as CameraBridge } from '@haus/homekit/controller';
import { nodeJson, nodeRequest } from '@haus/servers';
import { join } from 'node:path';
import { openCatalog, Transactions } from '../storage/index.js';
import { HomeKitIdentityStore } from './identity-store.js';
import { nvrCameraSource } from '../camera/index.js';
import { cameraSource } from '@haus/media/source';

export { homekitSettings, recordingProfile } from '@haus/homekit/controller';

type IdentityStoragePort = NonNullable<
  ConstructorParameters<typeof CameraBridge>[0]['identityStorage']
> & {
  close?: () => Promise<void>;
};

function persistentIdentities(
  database: string,
  transactions?: Transactions,
): IdentityStoragePort {
  if (transactions) return new HomeKitIdentityStore(transactions);
  const source = openCatalog(database);
  const store = source.then((value) => new HomeKitIdentityStore(new Transactions(value)));
  return {
    list: async () => (await store).list(),
    save: async (...values: Parameters<HomeKitIdentityStore['save']>) =>
      (await store).save(...values),
    delete: async (...values: Parameters<HomeKitIdentityStore['delete']>) =>
      (await store).delete(...values),
    close: async () => (await source).destroy(),
  };
}

export type HomeKitCamerasOptions = Omit<
  ConstructorParameters<typeof CameraBridge>[0],
  | 'json'
  | 'request'
  | 'resolveSource'
  | 'validateSource'
  | 'identityStorage'
  | 'store'
  | 'sessions'
  | 'talkback'
> & {
  identityStorage?: IdentityStoragePort;
  identityTransactions?: Transactions;
  config: { data: string; homekit_address?: string; [key: string]: unknown };
  store: {
    overrides: () => unknown;
  };
  sessions:
    | ConstructorParameters<typeof CameraBridge>[0]['sessions']
    | import('../camera/index.js').NvrCameraSessions;
  talkback:
    | ConstructorParameters<typeof CameraBridge>[0]['talkback']
    | ReturnType<typeof import('../camera/index.js').createTalkback>;
};

/** Helper owns HA discovery, root-authenticated worker requests and pairing storage. */
export class HomeKitCameras extends CameraBridge {
  ownedIdentityStorage?: IdentityStoragePort;

  constructor(options: HomeKitCamerasOptions) {
    const identityStorage =
      options.identityStorage ??
      persistentIdentities(join(options.config.data, 'haus.sqlite'), options.identityTransactions);
    const bridgeOptions: Partial<ConstructorParameters<typeof CameraBridge>[0]> = {
      json: nodeJson,
      request: nodeRequest,
      resolveSource: nvrCameraSource as ConstructorParameters<typeof CameraBridge>[0]['resolveSource'],
      validateSource: cameraSource,
      ...(options as Partial<ConstructorParameters<typeof CameraBridge>[0]>),
      identityStorage,
    };
    super(bridgeOptions as ConstructorParameters<typeof CameraBridge>[0]);
    this.ownedIdentityStorage =
      options.identityStorage || options.identityTransactions ? undefined : identityStorage;
  }

  override async stop(): Promise<void> {
    try {
      await super.stop();
    } finally {
      await this.ownedIdentityStorage?.close?.();
    }
  }
}
