/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { validateHandoffRequest, type MatterHandoffRequest } from '@haus/matter';
import { AuthGuard } from '../auth/auth.guard.js';
import { MatterHandoffService } from './matter-handoff.service.js';

function resolveHomeId(req: Request & { session?: { homeId?: string } }): string {
  const headerHome = req.headers['x-haus-home-id'] as string | undefined;
  if (headerHome && req.session?.homeId && headerHome !== req.session.homeId) {
    throw new ForbiddenException({ error: 'wrong_home' });
  }
  return headerHome ?? req.session?.homeId ?? process.env.HAUS_HOME_ID ?? 'home-default';
}

@ApiTags('Commissioning')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api/commissioning/matter-handoff')
export class MatterHandoffController {
  constructor(private readonly handoffService: MatterHandoffService) {}

  @Post('initiate')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Initiate remote Matter handoff from authorized temporary commissioner to permanent Hub controller',
  })
  initiate(
    @Req() req: Request & { session?: { homeId?: string } },
    @Body() body: Record<string, unknown>,
  ) {
    const homeId = resolveHomeId(req);
    const bodyHome = body.homeId as string | undefined;
    if (bodyHome && bodyHome !== homeId) {
      throw new ForbiddenException({ error: 'wrong_home' });
    }

    try {
      validateHandoffRequest(body);
      const request: MatterHandoffRequest = {
        handoffId: String(body.handoffId ?? `handoff-${Date.now()}`),
        commissioningId: String(body.commissioningId ?? `comm-${Date.now()}`),
        homeId,
        temporaryCommissionerId: String(body.temporaryCommissionerId ?? 'temporary-commissioner'),
        targetIp: String(body.targetIp ?? ''),
        targetPort: typeof body.targetPort === 'number' ? body.targetPort : 5540,
        discriminator: Number(body.discriminator),
        passcode: Number(body.passcode),
        manualPairingCode: body.manualPairingCode ? String(body.manualPairingCode) : undefined,
        qrPairingCode: body.qrPairingCode ? String(body.qrPairingCode) : undefined,
        temporaryFabricIndex: Number(body.temporaryFabricIndex),
        windowExpiresAt: Number(body.windowExpiresAt),
      };

      const session = this.handoffService.initiateHandoff(request);
      return { status: 'created', session };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('forbidden_credential_transfer')) {
        throw new BadRequestException({ error: 'forbidden_credential_transfer', message: msg });
      }
      throw new BadRequestException({ error: 'invalid_handoff_request', message: msg });
    }
  }

  @Post(':id/commission')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Hub establishes permanent controller fabric over IP using open commissioning window',
  })
  async commission(
    @Req() req: Request & { session?: { homeId?: string } },
    @Param('id') id: string,
  ) {
    const homeId = resolveHomeId(req);
    const session = this.handoffService.getSession(id);
    if (!session) {
      throw new NotFoundException({ error: 'handoff_session_not_found' });
    }
    if (session.homeId !== homeId) {
      throw new ForbiddenException({ error: 'wrong_home' });
    }

    try {
      const updated = await this.handoffService.executeHubCommissioning(id);
      return { status: 'commissioned', session: updated };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('commissioning_window_expired')) {
        throw new BadRequestException({ error: 'commissioning_window_expired' });
      }
      throw new BadRequestException({ error: 'hub_commissioning_failed', message: msg });
    }
  }

  @Post(':id/remove-temporary-fabric')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Removes temporary fabric after Hub permanent verification; preserves fabric on uncertain ack',
  })
  async removeTemporaryFabric(
    @Req() req: Request & { session?: { homeId?: string } },
    @Param('id') id: string,
  ) {
    const homeId = resolveHomeId(req);
    const session = this.handoffService.getSession(id);
    if (!session) {
      throw new NotFoundException({ error: 'handoff_session_not_found' });
    }
    if (session.homeId !== homeId) {
      throw new ForbiddenException({ error: 'wrong_home' });
    }

    try {
      const result = await this.handoffService.removeTemporaryFabric(id);
      return { status: result.removed ? 'removed' : 'uncertain_preserved', ...result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('permanent_fabric_not_verified')) {
        throw new BadRequestException({
          error: 'permanent_fabric_not_verified',
          message:
            'Temporary fabric cannot be removed before permanent Hub controller verification is proven',
        });
      }
      throw new BadRequestException({ error: 'temporary_fabric_removal_failed', message: msg });
    }
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reopens commissioning window after expiry' })
  reopen(
    @Req() req: Request & { session?: { homeId?: string } },
    @Param('id') id: string,
    @Body() body: { newExpiresAt: number; newPasscode?: number; newDiscriminator?: number },
  ) {
    const homeId = resolveHomeId(req);
    const session = this.handoffService.getSession(id);
    if (!session) {
      throw new NotFoundException({ error: 'handoff_session_not_found' });
    }
    if (session.homeId !== homeId) {
      throw new ForbiddenException({ error: 'wrong_home' });
    }

    try {
      const updated = this.handoffService.reopenWindow(
        id,
        body.newExpiresAt,
        body.newPasscode,
        body.newDiscriminator,
      );
      return { status: 'reopened', session: updated };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException({ error: 'window_reopen_failed', message: msg });
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get status of a Matter handoff session' })
  getSession(
    @Req() req: Request & { session?: { homeId?: string } },
    @Param('id') id: string,
  ) {
    const homeId = resolveHomeId(req);
    const session = this.handoffService.getSession(id);
    if (!session) {
      throw new NotFoundException({ error: 'handoff_session_not_found' });
    }
    if (session.homeId !== homeId) {
      throw new ForbiddenException({ error: 'wrong_home' });
    }
    return { session };
  }
}
