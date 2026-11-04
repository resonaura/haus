/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HomeKitCameras as CameraBridge } from '@haus/homekit/controller';
import { nodeJson, nodeRequest } from './node-client.mjs';
import { nvrCameraSource } from './nvr-camera-sessions.mjs';
import { cameraSource } from './local-camera-source.mjs';

export { homekitSettings, recordingProfile } from '@haus/homekit/controller';

/** Helper owns HA discovery, root-authenticated worker requests and pairing storage. */
export class HomeKitCameras extends CameraBridge {
  constructor(options) {
    super({ json: nodeJson, request: nodeRequest, resolveSource: nvrCameraSource,
      validateSource: cameraSource, ...options });
  }
}
