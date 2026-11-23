/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'node:http';
import { AuthGuard } from '../../auth/auth.guard.js';
import { appActor } from '../../home/actor.js';
import { HaFlowBridgeService } from './bridge.service.js';
import { escapeHtml, parseMultipartFileFromRequest } from './helpers.js';
import { parseHaEntryImport } from './import.js';

@ApiTags('Commissioning')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/commissioning')
export class HaFlowController {
  constructor(private readonly bridgeService: HaFlowBridgeService) {}

  @Get('flows/progress')
  @ApiOperation({ summary: 'List active HA discovery / in-progress configuration flows' })
  async listProgressFlows() {
    const flows = await this.bridgeService.listProgressFlows();
    return { flows, nativeDiscoveryDomains: this.bridgeService.getNativeDiscoveryDomains() };
  }

  @Get('entities/:entityId/image')
  @ApiOperation({
    summary: 'Fetch live image bytes from a Home Assistant image.* entity (e.g. Wi-Fi QR)',
  })
  async getEntityImage(@Param('entityId') entityId: string) {
    if (!/^image\.[a-z0-9_]{1,128}$/.test(entityId)) {
      throw new BadRequestException({ error: 'invalid_image_entity_id' });
    }
    try {
      const result = await this.bridgeService.getEntityImage(entityId);
      return {
        ...result,
        dataUrl: `data:${result.contentType};base64,${result.contentBase64}`,
      };
    } catch (cause: unknown) {
      const code = cause instanceof Error ? cause.message : '';
      if (code === 'image_entity_not_found' || code === 'image_unavailable') {
        throw new NotFoundException({ error: code });
      }
      if (code === 'ha_flow_runtime_unavailable') {
        throw new ServiceUnavailableException({ error: code });
      }
      throw new InternalServerErrorException({ error: 'entity_image_unavailable' });
    }
  }

  @Get('updates/:entityId/release-notes')
  @ApiOperation({
    summary: 'Fetch release notes and version metadata for a Home Assistant update.* entity',
  })
  async getUpdateReleaseNotes(@Param('entityId') entityId: string) {
    if (!/^update\.[a-z0-9_]{1,128}$/.test(entityId)) {
      throw new BadRequestException({ error: 'invalid_update_entity_id' });
    }
    try {
      return await this.bridgeService.getUpdateReleaseNotes(entityId);
    } catch (cause: unknown) {
      const code = cause instanceof Error ? cause.message : '';
      if (code === 'update_entity_not_found') {
        throw new NotFoundException({ error: code });
      }
      if (code === 'ha_flow_runtime_unavailable') {
        throw new ServiceUnavailableException({ error: code });
      }
      throw new InternalServerErrorException({ error: 'update_release_notes_unavailable' });
    }
  }

  @Get('hue/scene-diagnostics/:entryId')
  @ApiOperation({ summary: 'Read redacted Hue bridge diagnostics for scene color previews' })
  async getHueSceneDiagnostics(@Req() req: FastifyRequest, @Param('entryId') entryId: string) {
    appActor(req, true);
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(entryId)) {
      throw new BadRequestException({ error: 'invalid_hue_config_entry' });
    }
    try {
      return await this.bridgeService.getHueSceneDiagnostics(entryId);
    } catch (cause: unknown) {
      const code = cause instanceof Error ? cause.message : '';
      if (code === 'hue_config_entry_not_found') {
        throw new NotFoundException({ error: code });
      }
      if (code === 'ha_flow_runtime_unavailable' || code === 'hue_diagnostics_unavailable') {
        throw new ServiceUnavailableException({ error: code });
      }
      throw new InternalServerErrorException({ error: 'hue_scene_diagnostics_unavailable' });
    }
  }

  @Post('entries/import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stage an existing Home Assistant entry without activating it' })
  async importEntry(@Req() req: FastifyRequest, @Body() body?: unknown) {
    appActor(req, true);
    const input = parseHaEntryImport(body);
    try {
      return await this.bridgeService.importEntry(input);
    } catch (cause: unknown) {
      const code = cause instanceof Error ? cause.message : '';
      if (
        code === 'integration_entry_conflict' ||
        code === 'integration_entry_identity_conflict' ||
        code === 'integration_entity_conflict'
      ) {
        throw new ConflictException({ error: code });
      }
      if (code === 'unsupported_import_domain' || code === 'import_entry_must_be_disabled') {
        throw new BadRequestException({ error: code });
      }
      if (code === 'ha_flow_runtime_unavailable') {
        throw new ServiceUnavailableException({ error: code });
      }
      throw new InternalServerErrorException({ error: 'integration_import_failed' });
    }
  }

  @Get('translations')
  @ApiOperation({ summary: 'Get HA frontend-style localized config flow translations' })
  async getTranslations(
    @Query('category') category = 'config',
    @Query('integrations') integrationsParam?: string,
  ) {
    const integrations = integrationsParam
      ? integrationsParam
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined;
    const resources = await this.bridgeService.getTranslations(category, integrations);
    return { category, resources };
  }

  @Get('application-credentials')
  @ApiOperation({ summary: 'List configured OAuth2 application credentials' })
  async listApplicationCredentials() {
    const credentials = await this.bridgeService.listApplicationCredentials();
    return { credentials };
  }

  @Post('application-credentials')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create or update an OAuth2 application credential for a domain' })
  async addApplicationCredential(
    @Body()
    body?: {
      domain?: string;
      clientId?: string;
      client_id?: string;
      clientSecret?: string;
      client_secret?: string;
      name?: string;
      authDomain?: string;
      auth_domain?: string;
    },
  ) {
    const domain = body?.domain?.trim();
    const clientId = (body?.clientId ?? body?.client_id)?.trim();
    const clientSecret = (body?.clientSecret ?? body?.client_secret ?? '').trim();
    if (!domain || !clientId) {
      throw new BadRequestException({ error: 'domain_and_client_id_required' });
    }
    const stored = await this.bridgeService.addApplicationCredential({
      domain,
      clientId,
      clientSecret,
      name: body?.name?.trim(),
      authDomain: (body?.authDomain ?? body?.auth_domain)?.trim(),
    });
    return stored;
  }

  @Delete('application-credentials/:domain')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove OAuth2 application credentials for a domain' })
  async deleteApplicationCredential(@Param('domain') domain: string) {
    const deleted = await this.bridgeService.removeApplicationCredential(domain);
    if (!deleted) {
      throw new NotFoundException({ error: 'credential_not_found' });
    }
    return { deleted: true, domain };
  }

  @Post('files')
  @HttpCode(201)
  @ApiOperation({ summary: 'Upload a file (certificate, backup, keys) for an HA file selector' })
  async uploadFile(
    @Req() req: FastifyRequest,
    @Body() body?: { filename?: string; name?: string; contentBase64?: string; content?: string },
  ) {
    const contentType = req.headers['content-type'] ?? '';
    let filename = (body?.filename ?? body?.name)?.trim();
    let content: Buffer | undefined;

    if (typeof contentType === 'string' && contentType.includes('multipart/form-data')) {
      const stream: IncomingMessage = req.raw ?? (req as unknown as IncomingMessage);
      const parsed = await parseMultipartFileFromRequest(stream, contentType);
      if (parsed) {
        filename = parsed.filename;
        content = parsed.content;
      }
    } else if (typeof body?.contentBase64 === 'string') {
      content = Buffer.from(body.contentBase64, 'base64');
    } else if (typeof body?.content === 'string') {
      content = Buffer.from(body.content, 'utf8');
    }

    if (!filename || !content) {
      throw new BadRequestException({ error: 'file_payload_required' });
    }
    return this.bridgeService.uploadFile(filename, content);
  }

  @Post('oauth/callback')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete an external OAuth2 step using state and code/error' })
  async completeOAuthCallback(
    @Body()
    body?: {
      flowId?: string;
      state?: unknown;
      code?: string;
      error?: string;
    },
  ) {
    if (!body?.state && !body?.flowId) {
      throw new BadRequestException({ error: 'oauth_state_or_flow_id_required' });
    }
    try {
      return await this.bridgeService.completeExternalFlow({
        flowId: body.flowId,
        state: body.state,
        code: body.code,
        error: body.error,
      });
    } catch (err: unknown) {
      throw new BadRequestException({
        error: err instanceof Error ? err.message : 'oauth_callback_failed',
      });
    }
  }
}

@ApiTags('Commissioning')
@Controller('auth/external')
export class HaOAuthCallbackController {
  constructor(private readonly bridgeService: HaFlowBridgeService) {}

  @Get('callback')
  @ApiOperation({ summary: 'OAuth2 browser redirect endpoint completing an HA external step' })
  async handleBrowserOAuthRedirect(
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: FastifyReply,
  ) {
    if (!state) {
      res
        .status(400)
        .type('text/html; charset=utf-8')
        .send('<html><body><h3>Missing OAuth state</h3></body></html>');
      return;
    }
    try {
      const step = await this.bridgeService.completeExternalFlow({ state, code, error });
      const statusText = error
        ? `Authorization failed: ${escapeHtml(error)}`
        : 'Authorization completed';
      const safeFlowId = JSON.stringify(step.flowId)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e');
      const safeType = JSON.stringify(step.type).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
      res
        .status(200)
        .type('text/html; charset=utf-8')
        .send(
          `<!doctype html><html><body style="font-family:system-ui;padding:24px;text-align:center;">
          <h2>${statusText}</h2>
          <p>You can close this window and return to Haus.</p>
          <script>
            try {
              window.opener && window.opener.postMessage({ type: 'haus-oauth-complete', flowId: ${safeFlowId}, stepType: ${safeType} }, '*');
              window.close();
            } catch (e) {}
          </script>
        </body></html>`,
        );
    } catch (err: unknown) {
      const msg = escapeHtml(err instanceof Error ? err.message : 'OAuth callback failed');
      res
        .status(400)
        .type('text/html; charset=utf-8')
        .send(`<html><body><h3>${msg}</h3></body></html>`);
    }
  }
}
