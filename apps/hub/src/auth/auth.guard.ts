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
import { HubAuthService } from './service.js';
import { HUB_AUTH_SERVICE } from './tokens.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Optional()
    @Inject(HUB_AUTH_SERVICE)
    private readonly authService?: HubAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpException({ error: 'authentication_required' }, HttpStatus.UNAUTHORIZED);
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new HttpException({ error: 'authentication_required' }, HttpStatus.UNAUTHORIZED);
    }

    if (this.authService) {
      const session = await this.authService.authenticate(token);
      if (!session) {
        throw new HttpException({ error: 'invalid_credentials' }, HttpStatus.UNAUTHORIZED);
      }
      (request as Request & { user: unknown }).user = session;
    }

    return true;
  }
}
