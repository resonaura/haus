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
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { appActor } from './actor.js';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from './home.service.js';
import { CreateRoomDto, UpdateDeviceDto, UpdateRoomDto } from './room.dto.js';

function mapRoomError(err: unknown, fallbackCode: string): never {
  const code = err instanceof Error ? err.message : fallbackCode;
  switch (code) {
    case 'room_name_exists':
    case 'room_id_exists':
      throw new ConflictException({ error: code });
    case 'room_not_found':
    case 'target_room_not_found':
    case 'device_not_found':
      throw new NotFoundException({ error: code });
    case 'invalid_room_name':
    case 'invalid_room_id':
    case 'invalid_device_name':
    case 'cannot_delete_reserved_room':
      throw new BadRequestException({ error: code });
    default:
      throw new BadRequestException({ error: code || fallbackCode });
  }
}

@ApiTags('Home Domain')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api')
export class RoomsController {
  constructor(
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService: StandaloneHomeService,
  ) {}

  @Get('rooms')
  @ApiOperation({ summary: 'List all rooms registered on the home' })
  listRooms() {
    return { rooms: this.homeService.roomManager.listRooms() };
  }

  @Get('rooms/:id')
  @ApiOperation({ summary: 'Get a single room by ID' })
  getRoom(@Param('id') id: string) {
    const room = this.homeService.roomManager.getRoom(id);
    if (!room) {
      throw new NotFoundException({ error: 'room_not_found' });
    }
    return { room };
  }

  @Post('rooms')
  @ApiOperation({ summary: 'Create a new room on the home' })
  async createRoom(@Req() req: Request, @Body() body: CreateRoomDto) {
    appActor(req, true);
    try {
      const room = await this.homeService.roomManager.createRoom({
        id: body.id,
        name: body.name,
        icon: body.icon,
      });
      return { room };
    } catch (err: unknown) {
      mapRoomError(err, 'room_create_failed');
    }
  }

  @Patch('rooms/:id')
  @ApiOperation({ summary: 'Update a room name or icon' })
  async updateRoom(@Req() req: Request, @Param('id') id: string, @Body() body: UpdateRoomDto) {
    appActor(req, true);
    try {
      const room = await this.homeService.roomManager.updateRoom(id, {
        name: body.name,
        icon: body.icon,
      });
      return { room };
    } catch (err: unknown) {
      mapRoomError(err, 'room_update_failed');
    }
  }

  @Delete('rooms/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a room and move its devices back to Unassigned' })
  async deleteRoom(@Req() req: Request, @Param('id') id: string) {
    const actorId = appActor(req, true);
    try {
      return await this.homeService.roomManager.deleteRoom(id, { actorId, role: 'admin' });
    } catch (err: unknown) {
      mapRoomError(err, 'room_delete_failed');
    }
  }

  @Patch('devices/:id')
  @ApiOperation({ summary: 'Update a device display name or room assignment' })
  async updateDevice(@Req() req: Request, @Param('id') id: string, @Body() body: UpdateDeviceDto) {
    const actorId = appActor(req, true);
    try {
      const device = await this.homeService.roomManager.updateDevice(
        id,
        {
          name: body.name,
          roomId: body.roomId,
        },
        { actorId, role: 'admin' },
      );
      return { device };
    } catch (err: unknown) {
      mapRoomError(err, 'device_update_failed');
    }
  }
}
