/*
 * Haus — A thoughtful home.
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
import { HubAuthService } from '../auth/service.js';
import { HUB_AUTH_SERVICE } from '../auth/tokens.js';
import { ControlService } from './service.js';
import { CONTROL_SERVICE } from './types.js';

@Injectable()
export class ControlGuard implements CanActivate {
  constructor(
    @Optional()
    @Inject(CONTROL_SERVICE)
    private readonly controlService?: ControlService,
    @Optional()
    @Inject(HUB_AUTH_SERVICE)
    private readonly authService?: HubAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown; actorId?: string }>();
    const authHeader = request.headers.authorization;
    const actorHeader = request.headers['x-actor-id'];

    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (!token) {
        throw new HttpException({ error: 'authentication_required' }, HttpStatus.UNAUTHORIZED);
      }
      if (!this.authService) {
        throw new HttpException({ error: 'auth_service_unavailable' }, HttpStatus.UNAUTHORIZED);
      }
      const session = await this.authService.authenticate(token);
      if (!session) {
        throw new HttpException({ error: 'invalid_credentials' }, HttpStatus.UNAUTHORIZED);
      }
      request.user = session;
      const candidateActor =
        typeof actorHeader === 'string' && actorHeader.trim().length > 0
          ? actorHeader.trim()
          : (session.clientId ??
            (session as unknown as { actorId?: string }).actorId ??
            'local-admin');
      request.actorId = candidateActor;
      return true;
    }

    if (this.controlService && typeof actorHeader === 'string' && actorHeader.trim().length > 0) {
      request.actorId = actorHeader.trim();
      return true;
    }

    throw new HttpException({ error: 'authentication_required' }, HttpStatus.UNAUTHORIZED);
  }
}
