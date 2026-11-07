/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HomeKitCameras as CameraBridge } from '@haus/homekit/controller';
import { nodeJson, nodeRequest } from '@haus/servers';
import { join } from 'node:path';
import { openCatalog, Transactions } from '@haus/hub/storage';
import { HomeKitIdentityStore } from '@haus/hub/homekit';
import { nvrCameraSource } from './camera/sessions.mjs';
import { cameraSource } from '@haus/media/source';

export { homekitSettings, recordingProfile } from '@haus/homekit/controller';

function persistentIdentities(database, transactions) {
  if (transactions) return new HomeKitIdentityStore(transactions);
  const source = openCatalog(database);
  const store = source.then((value) => new HomeKitIdentityStore(new Transactions(value)));
  return {
    list: async () => (await store).list(),
    save: async (...values) => (await store).save(...values),
    delete: async (...values) => (await store).delete(...values),
    close: async () => (await source).destroy(),
  };
}

/** Helper owns HA discovery, root-authenticated worker requests and pairing storage. */
export class HomeKitCameras extends CameraBridge {
  constructor(options) {
    const identityStorage =
      options.identityStorage ??
      persistentIdentities(join(options.config.data, 'haus.sqlite'), options.identityTransactions);
    super({ json: nodeJson, request: nodeRequest, resolveSource: nvrCameraSource,
      validateSource: cameraSource, ...options, identityStorage });
    this.ownedIdentityStorage = options.identityStorage || options.identityTransactions ? undefined : identityStorage;
  }

  async stop() {
    try {
      await super.stop();
    } finally {
      await this.ownedIdentityStorage?.close();
    }
  }
}
