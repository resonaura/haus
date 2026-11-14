/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  DiscoveredCandidate,
  DiscoveryAdvertisementInput,
  DiscoveryProtocol,
} from '@haus/core';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { HubIntegrationEntryService } from './entries.js';
import { LanDiscoveryService } from './lan/scanner.js';
import { HubRepairsService } from './repairs.js';
import { CommissioningService } from './service.js';
import { HubUpdatesService } from './updates.js';

function resolveHomeId(req: Request & { session?: { homeId?: string } }): string {
  const headerHome = req.headers['x-haus-home-id'] as string | undefined;
  if (headerHome && req.session?.homeId && headerHome !== req.session.homeId) {
    throw new ForbiddenException({ error: 'wrong_home' });
  }
  return headerHome ?? req.session?.homeId ?? process.env.HAUS_HOME_ID ?? 'home-default';
}

@ApiTags('Integration Management')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api')
export class ManagementController {
  constructor(
    private readonly commissioning: CommissioningService,
    private readonly entries: HubIntegrationEntryService,
    private readonly repairs: HubRepairsService,
    private readonly updates: HubUpdatesService,
    @Optional() @Inject(LanDiscoveryService) private readonly lanDiscovery?: LanDiscoveryService,
  ) {}

  @Get('commissioning/integrations')
  @ApiOperation({ summary: 'List integration config entries, domain metadata, and discoveries' })
  async listIntegrations() {
    await this.commissioning.restorePersistedDiscoveryState();
    await this.commissioning.reconcileConfigured();
    const manifests = this.commissioning.catalog.getCatalog().getAllManifests();
    const [entries, metadata] = await Promise.all([
      this.entries.listEntries(),
      this.entries.listIntegrationMetadata(manifests),
    ]);
    return {
      entries,
      metadata,
      domains: this.commissioning.flows.getAvailableDomains(),
      discoveries: this.commissioning.listDiscoveries(),
    };
  }

  @Post('commissioning/discoveries/scan')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Actively scan LAN for discoverable devices (mDNS, SSDP, HomeKit, ARP)',
  })
  async scanDiscoveries(@Body() body?: { timeoutMs?: number }) {
    const timeoutMs =
      typeof body?.timeoutMs === 'number' && Number.isFinite(body.timeoutMs)
        ? body.timeoutMs
        : undefined;
    const discoveries = this.lanDiscovery
      ? await this.lanDiscovery.scan({ timeoutMs })
      : this.commissioning.listDiscoveries({ status: 'discovered' });
    return {
      scannedAt: new Date().toISOString(),
      discoveries,
    };
  }

  @Get('commissioning/discoveries/service-types')
  @ApiOperation({ summary: 'List mDNS and SSDP targets monitored by the integration catalog' })
  listDiscoveryServiceTypes() {
    return {
      serviceTypes: this.lanDiscovery
        ? this.lanDiscovery.collectCatalogZeroconfTypes()
        : ['_services._dns-sd._udp.local.'],
      ssdpTargets: this.lanDiscovery
        ? this.lanDiscovery.collectCatalogSsdpTargets()
        : ['ssdp:all', 'upnp:rootdevice'],
    };
  }

  @Post('commissioning/discoveries/announcements/batch')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ingest a batch of LAN discovery advertisements from a host relay' })
  async ingestAnnouncementBatch(
    @Body() body?: { advertisements?: unknown; matchedOnly?: boolean },
  ) {
    if (!body || !Array.isArray(body.advertisements)) {
      throw new BadRequestException({ error: 'advertisements must be an array' });
    }
    const validProtocols = new Set<DiscoveryProtocol>([
      'zeroconf',
      'ssdp',
      'dhcp',
      'mqtt',
      'homekit',
      'bluetooth',
      'usb',
    ]);
    await this.commissioning.restorePersistedDiscoveryState();
    const matchedOnly = body.matchedOnly !== false;
    const batch = body.advertisements.slice(0, 250);
    const byId = new Map<string, DiscoveredCandidate>();
    let matched = 0;

    for (const item of batch) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const candidateInput = item as Partial<DiscoveryAdvertisementInput>;
      if (
        typeof candidateInput.protocol !== 'string' ||
        !validProtocols.has(candidateInput.protocol)
      ) {
        continue;
      }
      const adv = candidateInput as DiscoveryAdvertisementInput;
      if (matchedOnly && !this.commissioning.matchesAdvertisement(adv)) continue;
      matched += 1;
      const stored = this.commissioning.ingestDiscovery(adv);
      byId.set(stored.id, stored);
    }

    if (matched > 0) {
      await this.commissioning.reconcileConfigured();
    }
    return {
      received: batch.length,
      matched,
      candidates: Array.from(byId.values()).map((c) => this.commissioning.getDiscovery(c.id) ?? c),
    };
  }

  @Post('commissioning/entries/:entryId/reload')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reload an integration config entry' })
  async reloadEntry(@Param('entryId') entryId: string) {
    return this.entries.reloadEntry(entryId);
  }

  @Post('commissioning/entries/:entryId/disable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enable or disable an integration config entry' })
  async disableEntry(@Param('entryId') entryId: string, @Body() body: { disabled?: boolean }) {
    const updated = await this.entries.setDisabled(entryId, body?.disabled !== false);
    if (!updated) throw new NotFoundException({ error: 'entry_not_found' });
    return updated;
  }

  @Delete('commissioning/entries/:entryId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete an integration config entry' })
  async deleteEntry(@Param('entryId') entryId: string) {
    const deleted = await this.entries.deleteEntry(entryId);
    if (!deleted) throw new NotFoundException({ error: 'entry_not_found' });
    return { deleted: true, entryId };
  }

  @Get('repairs')
  @ApiOperation({ summary: 'List active Hub repair issues' })
  async listRepairs() {
    const issues = await this.repairs.listIssues();
    return { issues };
  }

  @Post('repairs/:domain/:issueId/ignore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ignore or unignore a repair issue' })
  async ignoreRepair(
    @Param('domain') domain: string,
    @Param('issueId') issueId: string,
    @Body() body: { ignore?: boolean },
  ) {
    const updated = await this.repairs.ignoreIssue(domain, issueId, body?.ignore !== false);
    if (!updated) throw new NotFoundException({ error: 'issue_not_found' });
    return updated;
  }

  @Post('repairs/issues/fix')
  @HttpCode(201)
  @ApiOperation({ summary: 'Start interactive repair flow for an issue' })
  async startRepairFix(
    @Req() req: Request & { session?: { homeId?: string; clientId?: string } },
    @Body() body: { handler?: string; issue_id?: string; issueId?: string },
  ) {
    const handler = body?.handler;
    const issueId = body?.issue_id ?? body?.issueId;
    if (!handler || !issueId) {
      throw new BadRequestException({ error: 'handler_and_issue_id_required' });
    }
    return this.repairs.startFixFlow({
      handler,
      issueId,
      homeId: resolveHomeId(req),
      userId: req.session?.clientId ?? 'local-user',
    });
  }

  @Post('repairs/issues/fix/:flowId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit repair fix step' })
  async submitRepairFix(
    @Req() req: Request & { session?: { homeId?: string; clientId?: string } },
    @Param('flowId') flowId: string,
    @Body()
    body: { values?: Record<string, unknown>; nextStepId?: string } & Record<string, unknown>,
  ) {
    const { values, nextStepId, ...rest } = body ?? {};
    const stepValues = values && typeof values === 'object' ? values : rest;
    try {
      return await this.repairs.submitFixStep({
        flowId,
        homeId: resolveHomeId(req),
        userId: req.session?.clientId ?? 'local-user',
        values: stepValues,
        nextStepId,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'repair_step_failed';
      if (msg === 'flow_not_found') throw new NotFoundException({ error: msg });
      throw new BadRequestException({ error: msg });
    }
  }

  @Delete('repairs/issues/fix/:flowId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an active repair fix flow' })
  cancelRepairFix(
    @Req() req: Request & { session?: { homeId?: string } },
    @Param('flowId') flowId: string,
  ) {
    const ok = this.repairs.cancelFixFlow(flowId, { homeId: resolveHomeId(req) });
    if (!ok) throw new NotFoundException({ error: 'flow_not_found' });
    return { status: 'cancelled', flowId };
  }

  @Get('updates')
  @ApiOperation({
    summary: 'List updates across integrations, apps, Homebridge, Scrypted, and HACS',
  })
  async listUpdates(@Query('refresh') refresh?: string) {
    return this.updates.listUpdates(refresh === '1' || refresh === 'true');
  }

  @Post('updates/check')
  @HttpCode(200)
  @ApiOperation({ summary: 'Force refresh update check across all runtimes' })
  async checkUpdates() {
    return this.updates.listUpdates(true);
  }

  @Post('updates/install')
  @HttpCode(200)
  @ApiOperation({ summary: 'Install an available update by item id' })
  async installUpdate(
    @Req() req: Request & { session?: { clientId?: string } },
    @Body() body: { id?: string },
  ) {
    if (!body?.id) throw new BadRequestException({ error: 'update_id_required' });
    const res = await this.updates.installUpdate(body.id, req.session?.clientId ?? 'hub');
    if (res.status === 'error' || res.status === 'unsupported') {
      throw new BadRequestException(res);
    }
    return res;
  }
}
