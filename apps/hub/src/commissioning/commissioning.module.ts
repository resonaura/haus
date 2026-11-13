/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module } from '@nestjs/common';
import { KitsuneModule } from '../kitsune/kitsune.module.js';
import { CatalogController } from './catalog.controller.js';
import { CommissioningController } from './controller.js';
import { CommissioningCredentialsController } from './credentials.controller.js';
import { HubNetworkCredentialService } from './credentials.service.js';
import { HubIntegrationEntryService } from './entries.js';
import { ManagementController } from './management.controller.js';
import { CommissioningPlatformController } from './platform.controller.js';
import { HubRepairsService } from './repairs.js';
import { CommissioningService } from './service.js';
import { MatterHandoffController } from './matter-handoff.controller.js';
import { MatterHandoffService } from './matter-handoff.service.js';
import { HubTuyaService } from './tuya/service.js';
import { HubUpdatesService } from './updates.js';
import { VendorCommissioningController } from './vendor.controller.js';
import { VendorCommissioningService } from './vendor.service.js';

@Module({
  imports: [KitsuneModule],
  controllers: [
    CatalogController,
    CommissioningController,
    CommissioningCredentialsController,
    CommissioningPlatformController,
    ManagementController,
    MatterHandoffController,
    VendorCommissioningController,
  ],
  providers: [
    CommissioningService,
    HubNetworkCredentialService,
    HubTuyaService,
    HubIntegrationEntryService,
    HubRepairsService,
    HubUpdatesService,
    MatterHandoffService,
    VendorCommissioningService,
  ],
  exports: [
    CommissioningService,
    HubNetworkCredentialService,
    HubTuyaService,
    HubIntegrationEntryService,
    HubRepairsService,
    HubUpdatesService,
    MatterHandoffService,
    VendorCommissioningService,
  ],
})
export class CommissioningModule {}
