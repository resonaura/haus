/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard.js';
import { appActor } from '../actor.js';
import { CustomAddonRepositoryService } from './repositories.js';

function mapRepoError(err: unknown): never {
  const msg = err instanceof Error ? err.message : 'addon_repository_error';
  if (msg === 'addon_repository_not_found') {
    throw new NotFoundException({ error: msg });
  }
  if (msg === 'addon_repository_already_exists' || msg.startsWith('addon_repository_in_use:')) {
    throw new ConflictException({ error: msg });
  }
  throw new BadRequestException({ error: msg });
}

@ApiTags('apps')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/apps/repositories')
export class AddonRepositoriesController {
  constructor(private readonly repositories: CustomAddonRepositoryService) {}

  @Get()
  @ApiOperation({ summary: 'List custom Home Assistant Supervisor-compatible add-on repositories' })
  async list(@Req() req: object) {
    appActor(req);
    return { repositories: await this.repositories.listRepositories() };
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Validate and add a custom add-on repository URL' })
  async add(@Req() req: object, @Body() body: { readonly url?: unknown }) {
    appActor(req, true);
    if (typeof body?.url !== 'string' || !body.url.trim()) {
      throw new BadRequestException({ error: 'addon_repository_url_required' });
    }
    try {
      const repository = await this.repositories.addRepository(body.url);
      return { repository };
    } catch (err: unknown) {
      mapRepoError(err);
    }
  }

  @Post('reload')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reload all custom add-on repositories' })
  async reloadAll(@Req() req: object) {
    appActor(req, true);
    try {
      const repositories = await this.repositories.reloadRepository();
      return { repositories };
    } catch (err: unknown) {
      mapRepoError(err);
    }
  }

  @Post(':id/reload')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reload a specific custom add-on repository' })
  async reloadOne(@Req() req: object, @Param('id') id: string) {
    appActor(req, true);
    try {
      const list = await this.repositories.reloadRepository(id);
      return { repository: list[0] };
    } catch (err: unknown) {
      mapRepoError(err);
    }
  }

  @Post(':id/remove')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a custom add-on repository when unused by installed apps' })
  async removePost(@Req() req: object, @Param('id') id: string) {
    appActor(req, true);
    try {
      return await this.repositories.removeRepository(id);
    } catch (err: unknown) {
      mapRepoError(err);
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a custom add-on repository when unused by installed apps' })
  async removeDelete(@Req() req: object, @Param('id') id: string) {
    appActor(req, true);
    try {
      return await this.repositories.removeRepository(id);
    } catch (err: unknown) {
      mapRepoError(err);
    }
  }
}
