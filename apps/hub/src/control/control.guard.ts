/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';
import type { Request } from 'express';
import { ControlService } from './service.js';
import { CONTROL_SERVICE } from './types.js';

@Injectable()
export class ControlGuard implements CanActivate {
  constructor(
    @Optional()
    @Inject(CONTROL_SERVICE)
    private readonly controlService?: ControlService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const actorHeader = request.headers['x-actor-id'];
    const authHeader = request.headers.authorization;

    if (typeof actorHeader === 'string' && actorHeader.trim().length > 0) {
      return true;
    }
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return true;
    }

    throw new HttpException(
      { error: 'authentication_required' },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
