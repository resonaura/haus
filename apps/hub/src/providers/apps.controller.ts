/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  UseGuards,
  HttpCode,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { AppAccessories } from './accessories.js';
import { appActor } from '../home/actor.js';

@UseGuards(AuthGuard)
@Controller('api/apps')
export class AppAccessoriesController {
  constructor(@Inject(AppAccessories) private readonly accessories: AppAccessories) {}

  @Get(':id/accessories')
  async read(@Req() request: Request, @Param('id') id: string) {
    return this.perform(() => this.accessories.read(appActor(request), id));
  }

  @Post(':id/accessories/sync')
  @HttpCode(200)
  async sync(@Req() request: Request, @Param('id') id: string) {
    const actor = appActor(request, true);
    return this.perform(() => this.accessories.sync(actor, id));
  }

  private async perform(action: () => Promise<unknown>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      const code = error instanceof Error ? error.message : '';
      throw new BadRequestException({
        error: /^[a-z_]{1,80}$/.test(code) ? code : 'app_accessories_unavailable',
      });
    }
  }
}
