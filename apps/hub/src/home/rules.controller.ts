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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  DispatchAutomationEventDto,
  RegisterAutomationDto,
  RegisterSceneDto,
  RegisterScriptDto,
} from './home.dto.js';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from './home.service.js';

@ApiTags('Home Rules')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api')
export class RulesController {
  constructor(
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService: StandaloneHomeService,
  ) {}

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
      description: body.description,
      icon: body.icon,
      roomId: body.roomId,
      members: body.members,
      metadata: body.metadata,
    });
    return { scene };
  }

  @Post('scenes/:id/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a standalone scene and apply member target states' })
  @ApiParam({ name: 'id', description: 'Scene ID' })
  async activateScene(@Param('id') id: string) {
    try {
      return { execution: await this.homeService.activateScene(id) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'scene_activation_failed';
      if (msg === 'scene_not_found') throw new NotFoundException({ error: msg });
      throw new BadRequestException({ error: msg });
    }
  }

  @Delete('scenes/:id')
  @ApiOperation({ summary: 'Remove a standalone scene' })
  removeScene(@Param('id') id: string) {
    if (!this.homeService.removeScene(id)) {
      throw new NotFoundException({ error: 'scene_not_found' });
    }
    return { removed: true, id };
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
      description: body.description,
      icon: body.icon,
      mode: body.mode,
      steps: body.steps,
      metadata: body.metadata,
    });
    return { script };
  }

  @Post('scripts/:id/execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Execute a standalone script' })
  @ApiParam({ name: 'id', description: 'Script ID' })
  async executeScript(@Param('id') id: string) {
    try {
      return { execution: await this.homeService.executeScript(id) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'script_execution_failed';
      if (msg === 'script_not_found') throw new NotFoundException({ error: msg });
      throw new BadRequestException({ error: msg });
    }
  }

  @Delete('scripts/:id')
  @ApiOperation({ summary: 'Remove a standalone script' })
  removeScript(@Param('id') id: string) {
    if (!this.homeService.removeScript(id)) {
      throw new NotFoundException({ error: 'script_not_found' });
    }
    return { removed: true, id };
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
    const automation = this.homeService.registerAutomation({
      schemaVersion: 1,
      id: body.id,
      name: body.name,
      description: body.description,
      enabled: body.enabled ?? true,
      mode: body.mode,
      triggers: body.triggers,
      conditions: body.conditions,
      actions: body.actions,
      metadata: body.metadata,
    });
    return { automation };
  }

  @Post('automations/:id/trigger')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manually trigger a standalone automation rule' })
  @ApiParam({ name: 'id', description: 'Automation rule ID' })
  async triggerAutomation(@Param('id') id: string) {
    try {
      return { execution: await this.homeService.triggerAutomation(id) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'automation_trigger_failed';
      if (msg === 'automation_not_found') throw new NotFoundException({ error: msg });
      throw new BadRequestException({ error: msg });
    }
  }

  @Delete('automations/:id')
  @ApiOperation({ summary: 'Remove a standalone automation rule' })
  removeAutomation(@Param('id') id: string) {
    if (!this.homeService.removeAutomation(id)) {
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
    return { executions: await this.homeService.dispatchAutomationEvent(body) };
  }

  @Get('automations/history')
  @ApiOperation({ summary: 'List scene, script, and automation execution history' })
  listHistory(@Query('sourceId') sourceId?: string) {
    return { history: this.homeService.listExecutionHistory(sourceId) };
  }
}
