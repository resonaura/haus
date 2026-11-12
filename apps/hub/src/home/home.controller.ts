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
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { DeviceCategory, HausDevice } from '@haus/core';
import type { AppCatalogCategory, AppRuntimeType } from '@haus/apps';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  DeviceCommandDto,
  DispatchAutomationEventDto,
  ExecuteAppActionDto,
  InstallStandaloneAppDto,
  MoveDeviceRoomDto,
  OperateAppDto,
  RegisterAutomationDto,
  RegisterDeviceDto,
  RegisterSceneDto,
  RegisterScriptDto,
  UpdateAppDto,
} from './home.dto.js';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from './home.service.js';
import { appActor } from './actor.js';

function resolveActorId(req: Request): string {
  const session = (req as Request & { user?: { clientId?: string } }).user;
  return session?.clientId ?? 'local-admin';
}

@ApiTags('Home Domain')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api')
export class HomeController {
  constructor(
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService: StandaloneHomeService,
  ) {}

  @Get('devices')
  @ApiOperation({ summary: 'List canonical devices in the standalone Home registry' })
  listDevices(@Query('areaId') areaId?: string) {
    return {
      devices: this.homeService.listDevices(areaId),
    };
  }

  @Post('devices')
  @ApiOperation({ summary: 'Register or update a standalone device in the Home registry' })
  registerDevice(@Body() body: RegisterDeviceDto) {
    if (!body?.id || !body?.name) {
      throw new BadRequestException({ error: 'invalid_device_payload' });
    }
    const device: HausDevice = {
      id: body.id,
      source: { instanceId: 'standalone', externalId: body.id },
      name: body.name,
      category: (body.category ?? 'lighting') as DeviceCategory,
      roomId: body.roomId,
      areaId: body.areaId ?? body.roomId,
      connectivity: { protocol: 'virtual' },
      availability: body.available === false ? 'offline' : 'online',
      endpoints: body.endpoints ?? [],
      services: body.services ?? [],
    };
    return {
      device: this.homeService.registerDevice(device),
    };
  }

  @Get('states')
  @ApiOperation({ summary: 'Current state of every device endpoint in one response' })
  listStates() {
    return { states: this.homeService.listEndpointStates() };
  }

  @Get('devices/:id')
  @ApiOperation({ summary: 'Retrieve a registered device and its current endpoint states' })
  @ApiParam({ name: 'id', description: 'Device ID' })
  getDevice(@Param('id') id: string) {
    const device = this.homeService.getDevice(id);
    if (!device) {
      throw new NotFoundException({ error: 'device_not_found' });
    }
    const endpointStates: Record<string, Record<string, unknown>> = {};
    for (const ep of device.endpoints ?? []) {
      endpointStates[ep.id] = this.homeService.getEndpointState(ep.id);
    }
    return {
      device,
      endpointStates,
    };
  }

  @Delete('devices/:id')
  @ApiOperation({ summary: 'Remove a registered device from the Home registry' })
  @ApiParam({ name: 'id', description: 'Device ID' })
  removeDevice(@Param('id') id: string) {
    const removed = this.homeService.removeDevice(id);
    if (!removed) {
      throw new NotFoundException({ error: 'device_not_found' });
    }
    return { removed: true, id };
  }

  @Post('devices/:id/command')
  @HttpCode(200)
  @ApiOperation({ summary: 'Execute a command on a standalone device endpoint' })
  @ApiParam({ name: 'id', description: 'Device ID' })
  async executeDeviceCommand(@Param('id') id: string, @Body() body: DeviceCommandDto) {
    const device = this.homeService.getDevice(id);
    if (!device) {
      throw new NotFoundException({ error: 'device_not_found' });
    }
    if (!body?.endpointId || !body?.capability || !body?.command) {
      throw new BadRequestException({ error: 'invalid_command_payload' });
    }
    try {
      return await this.homeService.executeDeviceCommand(
        body.endpointId,
        body.capability,
        body.command,
        body.parameters,
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (
        [
          'mqtt_command_unsupported',
          'mqtt_command_template_unsupported',
          'mqtt_endpoint_unavailable',
        ].includes(code)
      )
        throw new BadRequestException({ error: code });
      throw error;
    }
  }

  @Post('devices/:id/move-room')
  @HttpCode(200)
  @ApiOperation({ summary: 'Atomically move a device to a new room and rewrite references' })
  @ApiParam({ name: 'id', description: 'Device ID' })
  async moveDeviceRoom(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: MoveDeviceRoomDto,
  ) {
    if (!body?.targetRoomId) {
      throw new BadRequestException({ error: 'invalid_move_room_payload' });
    }
    try {
      return await this.homeService.moveDeviceRoom({
        actor: { actorId: resolveActorId(req), role: 'admin' },
        deviceId: id,
        targetRoomId: body.targetRoomId,
        expectedRevision: body.expectedRevision,
        collisionPolicy: body.collisionPolicy,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'room_move_failed';
      if (msg === 'device_not_found' || msg === 'target_room_not_found') {
        throw new NotFoundException({ error: msg });
      }
      throw new BadRequestException({ error: msg });
    }
  }

  @Get('scenes')
  @ApiOperation({ summary: 'List registered standalone scenes' })
  listScenes() {
    return { scenes: this.homeService.listScenes() };
  }

  @Post('scenes')
  @ApiOperation({ summary: 'Register a standalone scene' })
  registerScene(@Body() body: RegisterSceneDto) {
    if (!body?.id || !body?.name || !Array.isArray(body?.members)) {
      throw new BadRequestException({ error: 'invalid_scene_payload' });
    }
    const scene = this.homeService.registerScene({
      schemaVersion: 1,
      id: body.id,
      name: body.name,
      roomId: body.roomId,
      members: body.members,
    });
    return { scene };
  }

  @Post('scenes/:id/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a standalone scene and apply member target states' })
  @ApiParam({ name: 'id', description: 'Scene ID' })
  async activateScene(@Param('id') id: string) {
    try {
      const execution = await this.homeService.activateScene(id);
      return { execution };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'scene_activation_failed';
      if (msg === 'scene_not_found') {
        throw new NotFoundException({ error: msg });
      }
      throw new BadRequestException({ error: msg });
    }
  }

  @Get('scripts')
  @ApiOperation({ summary: 'List registered standalone scripts' })
  listScripts() {
    return { scripts: this.homeService.listScripts() };
  }

  @Post('scripts')
  @ApiOperation({ summary: 'Register a standalone script' })
  registerScript(@Body() body: RegisterScriptDto) {
    if (!body?.id || !body?.name || !Array.isArray(body?.steps)) {
      throw new BadRequestException({ error: 'invalid_script_payload' });
    }
    const script = this.homeService.registerScript({
      schemaVersion: 1,
      id: body.id,
      name: body.name,
      mode: body.mode,
      steps: body.steps,
    });
    return { script };
  }

  @Post('scripts/:id/execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Execute a standalone script' })
  @ApiParam({ name: 'id', description: 'Script ID' })
  async executeScript(@Param('id') id: string) {
    try {
      const execution = await this.homeService.executeScript(id);
      return { execution };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'script_execution_failed';
      if (msg === 'script_not_found') {
        throw new NotFoundException({ error: msg });
      }
      throw new BadRequestException({ error: msg });
    }
  }

  @Get('automations')
  @ApiOperation({ summary: 'List registered standalone automation rules' })
  listAutomations() {
    return { automations: this.homeService.listAutomations() };
  }

  @Post('automations')
  @ApiOperation({ summary: 'Register or update a standalone automation rule' })
  registerAutomation(@Body() body: RegisterAutomationDto) {
    if (
      !body?.id ||
      !body?.name ||
      !Array.isArray(body?.triggers) ||
      !Array.isArray(body?.actions)
    ) {
      throw new BadRequestException({ error: 'invalid_automation_payload' });
    }
    const rule = this.homeService.registerAutomation({
      schemaVersion: 1,
      id: body.id,
      name: body.name,
      enabled: body.enabled ?? true,
      mode: body.mode,
      triggers: body.triggers,
      conditions: body.conditions,
      actions: body.actions,
    });
    return { automation: rule };
  }

  @Delete('automations/:id')
  @ApiOperation({ summary: 'Remove a standalone automation rule' })
  removeAutomation(@Param('id') id: string) {
    const removed = this.homeService.removeAutomation(id);
    if (!removed) {
      throw new NotFoundException({ error: 'automation_not_found' });
    }
    return { removed: true, id };
  }

  @Post('automations/dispatch')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dispatch an event through the local automation engine' })
  async dispatchAutomation(@Body() body: DispatchAutomationEventDto) {
    if (!body?.type) {
      throw new BadRequestException({ error: 'invalid_trigger_event' });
    }
    const executions = await this.homeService.dispatchAutomationEvent(body);
    return { executions };
  }

  @Get('automations/history')
  @ApiOperation({ summary: 'List scene, script, and automation execution history' })
  listHistory(@Query('sourceId') sourceId?: string) {
    return {
      history: this.homeService.listExecutionHistory(sourceId),
    };
  }

  @Get('apps/catalog')
  @ApiOperation({ summary: 'List available apps and plugins from the trusted catalog' })
  listCatalog(
    @Query('category') category?: AppCatalogCategory,
    @Query('runtimeType') runtimeType?: AppRuntimeType,
    @Query('search') search?: string,
    @Query('channel') channel?: 'stable' | 'beta',
    @Query('installed') installed?: string,
  ) {
    return {
      entries: this.homeService.listMarketplace({
        category,
        runtimeType,
        search,
        channel,
        installed: installed === undefined ? undefined : installed === 'true',
      }),
    };
  }

  @Get('apps/catalog/:id')
  @ApiOperation({ summary: 'Get details and versions for a specific catalog entry' })
  getCatalogEntry(@Param('id') id: string) {
    const entry = this.homeService.getAppCatalogEntry(id);
    if (!entry) throw new NotFoundException({ error: 'catalog_entry_not_found' });
    return { entry };
  }

  @Get('apps')
  @ApiOperation({ summary: 'List installed standalone Apps and registered App drivers' })
  async listApps(@Req() req: Request) {
    return this.homeService.listApps(appActor(req));
  }

  @Post('apps/install')
  @ApiOperation({ summary: 'Validate permissions and install a standalone App manifest' })
  async installApp(@Req() req: Request, @Body() body: InstallStandaloneAppDto) {
    if (!body?.manifest) {
      throw new BadRequestException({ error: 'invalid_manifest_payload' });
    }
    const actor = appActor(req, true);
    try {
      return await this.homeService.installApp(
        actor,
        body.manifest,
        body.grantedPermissions ?? [],
        body.config,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'install_failed';
      throw new BadRequestException({ error: msg });
    }
  }

  @Get('apps/:id/install-progress')
  @ApiOperation({ summary: 'Get current or most recent standalone App installation progress' })
  getAppInstallProgress(@Param('id') id: string) {
    const progress = this.homeService.getAppInstallProgress(id);
    if (!progress) throw new NotFoundException({ error: 'app_install_progress_not_found' });
    return progress;
  }

  @Post('apps/:id/execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Execute start/stop/restart action on an installed App' })
  async executeApp(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ExecuteAppActionDto,
  ) {
    const actor = appActor(req, true);
    try {
      await this.homeService.executeApp(actor, id, body.action);
      return { status: 'ok', appId: id, action: body.action };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'app_action_failed';
      if (msg === 'unknown_app') {
        throw new NotFoundException({ error: msg });
      }
      throw new BadRequestException({ error: msg });
    }
  }

  @Get('apps/:id/inspect')
  @ApiOperation({ summary: 'Inspect an installed App' })
  async inspectApp(@Req() req: Request, @Param('id') id: string) {
    const result = await this.homeService.inspectApp(appActor(req), id);
    if (result.status === 'error' && result.reason === 'unknown_app') {
      throw new NotFoundException({ error: 'unknown_app' });
    }
    return result;
  }

  @Post('apps/:id/operate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Perform an extended operation on an installed App' })
  async operateApp(@Req() req: Request, @Param('id') id: string, @Body() body: OperateAppDto) {
    const result = await this.homeService.operateApp(
      appActor(req, body.operation !== 'logs' && body.operation !== 'info'),
      id,
      body.operation,
      body.options,
    );
    if (result.status === 'error' && result.reason === 'unknown_app') {
      throw new NotFoundException({ error: 'unknown_app' });
    }
    return result;
  }

  @Get('apps/:id/update-check')
  @ApiOperation({ summary: 'Check if an update is available for an installed App' })
  checkAppUpdate(@Param('id') id: string) {
    return this.homeService.checkAppUpdate(id);
  }

  @Post('apps/:id/update')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Perform a transactional update of an installed App to its trusted catalog version',
  })
  async updateApp(@Req() req: Request, @Param('id') id: string, @Body() body?: UpdateAppDto) {
    const actor = appActor(req, true);
    const result = await this.homeService.updateApp(actor, id, body?.grantedPermissions);
    if (result.status === 'error') {
      if (result.reason === 'unknown_app') {
        throw new NotFoundException({ error: 'unknown_app' });
      }
      if (result.reason === 'no_update_available') {
        throw new BadRequestException({ error: 'no_update_available' });
      }
      if (result.reason === 'reauthorization_required') {
        const missing =
          result.data && typeof result.data === 'object' && 'missingPermissions' in result.data
            ? result.data.missingPermissions
            : undefined;
        throw new BadRequestException({
          error: 'reauthorization_required',
          missingPermissions: missing,
        });
      }
      throw new BadRequestException({ error: result.reason, details: result.data });
    }
    return result;
  }
}
