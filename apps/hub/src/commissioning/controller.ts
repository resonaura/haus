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
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  RemoteRadioAgentProxy,
  type CommissioningProtocol,
  type DiscoveryAdvertisementInput,
  type DiscoveryFilter,
  type DiscoveryProtocol,
  type DiscoveryStatus,
  type FlowSource,
  type RadioAgentCapabilities,
  type RadioAgentPlatform,
  type RadioRpcMessage,
} from '@haus/core';
import { AuthGuard } from '../auth/auth.guard.js';
import { CommissioningService } from './service.js';

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
@Controller('api/commissioning')
export class CommissioningController {
  constructor(private readonly service: CommissioningService) {}

  @Post('sessions')
  @HttpCode(202)
  @ApiOperation({ summary: 'Start code-first onboarding (Matter / HomeKit / Improv / Vendor)' })
  create(
    @Req() req: Request & { session?: { homeId?: string; clientId?: string } },
    @Body() body: { code?: string; deadlineMs?: number; contextProtocol?: CommissioningProtocol },
  ) {
    if (typeof body?.code !== 'string' || !body.code.trim()) {
      throw new BadRequestException({ error: 'setup_code_required' });
    }
    const homeId = resolveHomeId(req);
    const userId = req.session?.clientId ?? 'local-user';
    try {
      return this.service.create({
        code: body.code,
        homeId,
        userId,
        deadlineMs: body.deadlineMs,
        contextProtocol: body.contextProtocol,
      });
    } catch (err: unknown) {
      throw new BadRequestException({
        error: err instanceof Error ? err.message : 'invalid_setup_code',
      });
    }
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get commissioning transaction state and events' })
  get(
    @Req() req: Request & { session?: { homeId?: string } },
    @Param('id') id: string,
    @Query('sinceSeq') sinceSeq?: string,
  ) {
    const homeId = resolveHomeId(req);
    try {
      const tx = this.service.get(id, {
        homeId,
        sinceSeq: sinceSeq !== undefined ? Number(sinceSeq) : undefined,
      });
      if (!tx) throw new NotFoundException({ error: 'commissioning_not_found' });
      return tx;
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'wrong_home') {
        throw new ForbiddenException({ error: 'wrong_home' });
      }
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException({ error: err instanceof Error ? err.message : 'get_failed' });
    }
  }

  @Post('sessions/:id/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resume active commissioning session after client reconnect' })
  resume(
    @Req() req: Request & { session?: { homeId?: string; clientId?: string } },
    @Param('id') id: string,
  ) {
    const homeId = resolveHomeId(req);
    const userId = req.session?.clientId ?? 'local-user';
    try {
      const tx = this.service.resume(id, { homeId, activeOwner: userId });
      if (!tx) throw new NotFoundException({ error: 'commissioning_not_found' });
      return tx;
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'wrong_home') {
        throw new ForbiddenException({ error: 'wrong_home' });
      }
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException({
        error: err instanceof Error ? err.message : 'resume_failed',
      });
    }
  }

  @Post('sessions/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel active commissioning transaction' })
  cancel(@Req() req: Request & { session?: { homeId?: string } }, @Param('id') id: string) {
    const homeId = resolveHomeId(req);
    try {
      const ok = this.service.cancel(id, { homeId });
      if (!ok) throw new NotFoundException({ error: 'commissioning_not_found' });
      return { status: 'cancelled', commissioningId: id };
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'wrong_home') {
        throw new ForbiddenException({ error: 'wrong_home' });
      }
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException({
        error: err instanceof Error ? err.message : 'cancel_failed',
      });
    }
  }

  @Post('sessions/:id/select')
  @HttpCode(200)
  @ApiOperation({ summary: 'Select candidate device to commission' })
  selectCandidate(
    @Req() req: Request & { session?: { homeId?: string } },
    @Param('id') id: string,
    @Body() body: { candidateId?: string },
  ) {
    if (!body?.candidateId) {
      throw new BadRequestException({ error: 'candidate_id_required' });
    }
    const homeId = resolveHomeId(req);
    try {
      const tx = this.service.selectCandidate(id, body.candidateId, { homeId });
      if (!tx) throw new NotFoundException({ error: 'commissioning_not_found' });
      return tx;
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'wrong_home') {
        throw new ForbiddenException({ error: 'wrong_home' });
      }
      if (err instanceof Error && err.message === 'candidate_not_found') {
        throw new NotFoundException({ error: 'candidate_not_found' });
      }
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException({
        error: err instanceof Error ? err.message : 'select_failed',
      });
    }
  }

  @Post('sessions/:id/credentials')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Provide Wi-Fi or Thread network credentials when network.credentials.required',
  })
  async credentials(
    @Req() req: Request & { session?: { homeId?: string } },
    @Param('id') id: string,
    @Body()
    body: {
      ssid?: string;
      password?: string;
      threadDataset?: string;
      saveForReuse?: boolean;
    },
  ) {
    const hasWifi = body?.ssid && typeof body.password === 'string';
    const hasThread =
      typeof body?.threadDataset === 'string' && body.threadDataset.trim().length > 0;
    if (!hasWifi && !hasThread) {
      throw new BadRequestException({ error: 'network_credentials_required' });
    }
    const homeId = resolveHomeId(req);
    try {
      const tx = await this.service.provideCredentials(
        id,
        {
          wifi: hasWifi ? { ssid: body.ssid!, password: body.password! } : undefined,
          threadDataset: hasThread ? body.threadDataset : undefined,
          saveForReuse: body.saveForReuse,
        },
        { homeId },
      );
      if (!tx) throw new NotFoundException({ error: 'commissioning_not_found' });
      return tx;
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'wrong_home') {
        throw new ForbiddenException({ error: 'wrong_home' });
      }
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException({
        error: err instanceof Error ? err.message : 'credentials_failed',
      });
    }
  }

  @Post('sessions/:id/manual-address')
  @HttpCode(200)
  @ApiOperation({ summary: 'Provide manual IP address fallback when mDNS/DNS-SD is filtered' })
  manualAddress(
    @Req() req: Request & { session?: { homeId?: string } },
    @Param('id') id: string,
    @Body() body: { address?: string; port?: number },
  ) {
    if (!body?.address || typeof body.address !== 'string' || !body.address.trim()) {
      throw new BadRequestException({ error: 'ip_address_required' });
    }
    const homeId = resolveHomeId(req);
    try {
      const tx = this.service.provideManualAddress(
        id,
        { address: body.address.trim(), port: body.port },
        { homeId },
      );
      if (!tx) throw new NotFoundException({ error: 'commissioning_not_found' });
      return tx;
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'wrong_home') {
        throw new ForbiddenException({ error: 'wrong_home' });
      }
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException({
        error: err instanceof Error ? err.message : 'manual_address_failed',
      });
    }
  }

  @Get('radios')
  @ApiOperation({ summary: 'List registered radio agents and capabilities' })
  listRadios(@Req() req: Request & { session?: { homeId?: string } }) {
    const homeId = resolveHomeId(req);
    return this.service.radios.listDescriptors({ homeId });
  }

  @Post('radios/register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a nearby radio agent (desktop/mobile)' })
  registerRadio(
    @Req() req: Request & { session?: { homeId?: string } },
    @Body()
    body: {
      id?: string;
      name: string;
      platform: RadioAgentPlatform;
      capabilities?: RadioAgentCapabilities;
    },
  ) {
    if (!body?.name || !body?.platform) {
      throw new BadRequestException({ error: 'name_and_platform_required' });
    }
    const homeId = resolveHomeId(req);
    const agentId = body.id ?? `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const proxy = new RemoteRadioAgentProxy(
      {
        id: agentId,
        name: body.name,
        platform: body.platform,
        capabilities: body.capabilities ?? { bleScan: true, bleConnect: true },
        homeId,
        registeredAt: Date.now(),
        lastSeenAt: Date.now(),
        status: 'online',
      },
      () => {},
    );
    this.service.radios.register(proxy, proxy.descriptor);
    return proxy.descriptor;
  }

  @Post('radios/:agentId/heartbeat')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record radio agent heartbeat liveness' })
  radioHeartbeat(@Param('agentId') agentId: string) {
    const ok = this.service.radios.heartbeat(agentId);
    if (!ok) throw new NotFoundException({ error: 'agent_not_found' });
    return { status: 'ok', agentId, lastSeenAt: Date.now() };
  }

  @Delete('radios/:agentId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Unregister radio agent' })
  unregisterRadio(@Param('agentId') agentId: string) {
    const ok = this.service.radios.unregister(agentId);
    if (!ok) throw new NotFoundException({ error: 'agent_not_found' });
    return { status: 'unregistered', agentId };
  }

  @Post('radios/:agentId/rpc')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange transport RPC message with radio agent' })
  radioRpc(
    @Req() req: Request & { session?: { homeId?: string } },
    @Param('agentId') agentId: string,
    @Body() body: { message: RadioRpcMessage },
  ) {
    if (!body?.message?.type) {
      throw new BadRequestException({ error: 'rpc_message_required' });
    }
    const agent = this.service.radios.get(agentId);
    if (!agent) throw new NotFoundException({ error: 'agent_not_found' });
    if ('handleIncomingRpc' in agent && typeof agent.handleIncomingRpc === 'function') {
      agent.handleIncomingRpc(body.message);
    }
    return { status: 'ok' };
  }

  @Post('sessions/:id/claim-radio')
  @HttpCode(200)
  @ApiOperation({ summary: 'Claim exclusive radio transport owner for commissioning transaction' })
  claimRadio(
    @Req() req: Request & { session?: { homeId?: string } },
    @Param('id') id: string,
    @Body() body: { agentId?: string },
  ) {
    if (!body?.agentId) {
      throw new BadRequestException({ error: 'agent_id_required' });
    }
    const homeId = resolveHomeId(req);
    const tx = this.service.get(id, { homeId });
    if (!tx) throw new NotFoundException({ error: 'commissioning_not_found' });
    try {
      this.service.radios.claimTransportOwner(id, body.agentId);
      return { status: 'claimed', commissioningId: id, agentId: body.agentId };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'claim_failed';
      if (msg === 'agent_not_found') throw new NotFoundException({ error: msg });
      throw new BadRequestException({ error: msg });
    }
  }

  @Get('discoveries')
  @ApiOperation({ summary: 'List deduplicated discovered candidate devices' })
  listDiscoveries(
    @Query('status') status?: DiscoveryStatus | DiscoveryFilter,
    @Query('domain') domain?: string,
    @Query('protocol') protocol?: DiscoveryProtocol,
  ) {
    if (typeof status === 'object' && status !== null) {
      return this.service.listDiscoveries(status);
    }
    return this.service.listDiscoveries({ status, domain, protocol });
  }

  @Post('discoveries/announcements')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Ingest host discovery announcement (mDNS, SSDP, DHCP, BLE, USB, MQTT)',
  })
  ingestAnnouncement(@Body() body: DiscoveryAdvertisementInput) {
    if (!body?.protocol) {
      throw new BadRequestException({ error: 'protocol_required' });
    }
    return this.service.ingestDiscovery(body);
  }

  @Post('discoveries/:id/ignore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ignore a discovered candidate device' })
  ignoreDiscovery(@Param('id') id: string) {
    const ok = this.service.ignoreDiscovery(id);
    if (!ok) throw new NotFoundException({ error: 'discovery_not_found' });
    return { status: 'ignored', id };
  }

  @Post('discoveries/:id/unignore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore an ignored discovered candidate device' })
  unignoreDiscovery(@Param('id') id: string) {
    const ok = this.service.unignoreDiscovery(id);
    if (!ok) throw new NotFoundException({ error: 'discovery_not_found' });
    return { status: 'discovered', id };
  }

  @Post('flows')
  @HttpCode(201)
  @ApiOperation({ summary: 'Start integration configuration / pairing flow' })
  async startFlow(
    @Req() req: Request & { session?: { homeId?: string; clientId?: string } },
    @Body()
    body: {
      domain: string;
      candidateId?: string;
      source?: FlowSource;
      manualAddress?: { host: string; port?: number };
      reauthEntryId?: string;
      entryId?: string;
      showAdvancedOptions?: boolean;
      initialData?: Record<string, unknown>;
    },
  ) {
    if (!body?.domain) {
      throw new BadRequestException({ error: 'domain_required' });
    }
    const homeId = resolveHomeId(req);
    const userId = req.session?.clientId ?? 'local-user';
    try {
      return await this.service.startFlow({
        domain: body.domain,
        source: body.source,
        candidateId: body.candidateId,
        homeId,
        userId,
        manualAddress: body.manualAddress,
        reauthEntryId: body.reauthEntryId,
        entryId: body.entryId,
        showAdvancedOptions: body.showAdvancedOptions,
        initialData: body.initialData,
      });
    } catch (err: unknown) {
      throw new BadRequestException({
        error: err instanceof Error ? err.message : 'cannot_start_flow',
      });
    }
  }

  @Get('flows/:id')
  @ApiOperation({ summary: 'Get integration flow step state' })
  async getFlow(
    @Req() req: Request & { session?: { homeId?: string; clientId?: string } },
    @Param('id') id: string,
  ) {
    const homeId = resolveHomeId(req);
    const userId = req.session?.clientId ?? 'local-user';
    const step = await this.service.refreshFlow(id, { homeId, userId });
    if (!step) throw new NotFoundException({ error: 'flow_not_found' });
    return step;
  }

  @Post('flows/:id/step')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit integration flow step input' })
  async submitFlowStep(
    @Req() req: Request & { session?: { homeId?: string; clientId?: string } },
    @Param('id') id: string,
    @Body() body: { stepId?: string; nextStepId?: string; values?: Record<string, unknown> },
  ) {
    const homeId = resolveHomeId(req);
    const userId = req.session?.clientId ?? 'local-user';
    try {
      return await this.service.submitFlowStep({
        flowId: id,
        homeId,
        userId,
        stepId: body?.stepId,
        nextStepId: body?.nextStepId,
        values: body?.values ?? {},
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'step_failed';
      if (msg === 'flow_not_found') throw new NotFoundException({ error: msg });
      throw new BadRequestException({ error: msg });
    }
  }

  @Delete('flows/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel / abort an integration flow' })
  async cancelFlow(
    @Req() req: Request & { session?: { homeId?: string; clientId?: string } },
    @Param('id') id: string,
  ) {
    const homeId = resolveHomeId(req);
    const ok = await this.service.cancelFlowAsync(id, { homeId });
    if (!ok) throw new NotFoundException({ error: 'flow_not_found' });
    return { status: 'cancelled', flowId: id };
  }
}
