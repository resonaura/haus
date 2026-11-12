/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CommissioningController } from './controller.js';
import { CommissioningCredentialsController } from './credentials.controller.js';
import { HubNetworkCredentialService } from './credentials.service.js';
import { CommissioningPlatformController } from './platform.controller.js';
import { CommissioningService } from './service.js';
import { MatterHandoffController } from './matter-handoff.controller.js';
import { MatterHandoffService } from './matter-handoff.service.js';
import { VendorCommissioningController } from './vendor.controller.js';
import { VendorCommissioningService } from './vendor.service.js';

@Module({
  controllers: [
    CatalogController,
    CommissioningController,
    CommissioningCredentialsController,
    CommissioningPlatformController,
    MatterHandoffController,
    VendorCommissioningController,
  ],
  providers: [
    CommissioningService,
    HubNetworkCredentialService,
    MatterHandoffService,
    VendorCommissioningService,
  ],
  exports: [
    CommissioningService,
    HubNetworkCredentialService,
    MatterHandoffService,
    VendorCommissioningService,
  ],
})
export class CommissioningModule {}
