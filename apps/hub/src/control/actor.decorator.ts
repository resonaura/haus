/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createParamDecorator, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';

export const Actor = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request & { actorId?: string }>();
  if (typeof request.actorId === 'string' && request.actorId.trim().length > 0) {
    return request.actorId.trim();
  }
  const headerActor = request.headers['x-actor-id'];
  if (typeof headerActor === 'string' && headerActor.trim().length > 0) {
    return headerActor.trim();
  }
  throw new HttpException({ error: 'authentication_required' }, HttpStatus.UNAUTHORIZED);
});
