/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { DocsModule } from './docs/docs.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ControlModule } from './control/control.module.js';

@Module({
  imports: [
    HealthModule,
    DocsModule,
    AuthModule,
    ControlModule,
  ],
})
export class AppModule {}
