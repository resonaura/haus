/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync } from 'node:fs';
import { release } from 'node:os';
import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  evaluatePlatformCapabilities,
  type PlatformEnvironmentInput,
  type PlatformOperatingSystem,
  type PlatformRadioCapabilities,
} from '@haus/core';
import { AuthGuard } from '../auth/auth.guard.js';

@ApiTags('Commissioning')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api/commissioning/platform-matrix')
export class CommissioningPlatformController {
  @Get('current')
  @ApiOperation({ summary: 'Evaluate current Hub host platform radio and permission capabilities' })
  getCurrent(): PlatformRadioCapabilities {
    const rawPlat = process.platform;
    let os: PlatformOperatingSystem = 'linux';
    if (rawPlat === 'darwin') os = 'macos';
    else if (rawPlat === 'win32') os = 'windows';

    const isContainer = existsSync('/.dockerenv') || process.env.CONTAINER === 'true';
    const isWsl =
      existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') ||
      release().toLowerCase().includes('microsoft');
    const hasDbusSocket = existsSync('/run/dbus/system_bus_socket');
    const hasVhciDevice = existsSync('/dev/vhci');

    return evaluatePlatformCapabilities({
      os,
      osVersion: release(),
      isContainer,
      isWsl,
      hasDbusSocket,
      hasVhciDevice,
    });
  }

  @Post('evaluate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Evaluate client (desktop/mobile) platform radio and permission matrix with remediation',
  })
  evaluate(@Body() body: PlatformEnvironmentInput): PlatformRadioCapabilities {
    return evaluatePlatformCapabilities(body);
  }
}
