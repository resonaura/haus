/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module } from '@nestjs/common';
import { CommissioningController } from './controller.js';
import { CommissioningService } from './service.js';

@Module({
  controllers: [CommissioningController],
  providers: [CommissioningService],
})
export class CommissioningModule {}
