/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { HubAuthService } from './service.js';
import { HUB_AUTH_SERVICE } from './tokens.js';
import {
  PairRequestDto,
  ResumeRequestDto,
  RefreshRequestDto,
  LogoutRequestDto,
} from './auth.dto.js';

function extractBearer(header?: string): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+([a-zA-Z0-9_-]+)$/.exec(header);
  return match ? match[1] : undefined;
}

@ApiTags('Authentication')
@Controller('api/auth')
export class AuthController {
  constructor(
    @Optional()
    @Inject(HUB_AUTH_SERVICE)
    private readonly authService?: HubAuthService,
  ) {}

  private requireService(): HubAuthService {
    if (!this.authService) {
      throw new HttpException(
        { error: 'auth_service_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.authService;
  }

  @ApiOperation({ summary: 'Exchange pairing grant for client session credentials' })
  @ApiResponse({ status: 200, description: 'Client session successfully established' })
  @ApiResponse({ status: 400, description: 'Invalid grant or request payload' })
  @ApiResponse({ status: 401, description: 'Grant expired, revoked or verification failed' })
  @Post('pair')
  async pair(@Body() body: PairRequestDto) {
    if (!body?.grant) {
      throw new HttpException({ error: 'invalid_request_payload' }, HttpStatus.BAD_REQUEST);
    }
    const service = this.requireService();
    try {
      return await service.pair(body.grant);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'invalid_grant';
      throw new HttpException({ error: msg }, HttpStatus.UNAUTHORIZED);
    }
  }

  @ApiOperation({ summary: 'Resume established client session with bearer token' })
  @ApiBearerAuth('bearer')
  @ApiResponse({ status: 200, description: 'Session is active' })
  @ApiResponse({ status: 401, description: 'Session expired or invalid credentials' })
  @Post('resume')
  async resume(@Body() body: ResumeRequestDto, @Headers('authorization') authHeader?: string) {
    const token = extractBearer(authHeader);
    if (!token || !body?.sessionId) {
      throw new HttpException({ error: 'authentication_required' }, HttpStatus.UNAUTHORIZED);
    }
    const service = this.requireService();
    const result = await service.resume(body.sessionId, token);
    if (result.status === 'active' && result.session) {
      return { status: 'active', session: result.session };
    }
    throw new HttpException(
      { error: result.error ?? 'invalid_credentials' },
      HttpStatus.UNAUTHORIZED,
    );
  }

  @ApiOperation({ summary: 'Refresh client session bearer token' })
  @ApiResponse({ status: 200, description: 'Session renewed with fresh credentials' })
  @ApiResponse({ status: 400, description: 'Missing sessionId or refreshToken' })
  @ApiResponse({ status: 401, description: 'Reauth required or invalid refresh token' })
  @Post('refresh')
  async refresh(@Body() body: RefreshRequestDto) {
    if (!body?.sessionId || !body?.refreshToken) {
      throw new HttpException({ error: 'invalid_request_payload' }, HttpStatus.BAD_REQUEST);
    }
    const service = this.requireService();
    const result = await service.refresh(body.sessionId, body.refreshToken);
    if (result.status === 'renewed' && result.credentials) {
      return { status: 'renewed', credentials: result.credentials };
    }
    throw new HttpException({ error: result.error ?? 'reauth_required' }, HttpStatus.UNAUTHORIZED);
  }

  @ApiOperation({ summary: 'Terminate active client session (logout)' })
  @ApiBearerAuth('bearer')
  @ApiResponse({ status: 200, description: 'Session logged out' })
  @Post('logout')
  async logout(@Body() body: LogoutRequestDto, @Headers('authorization') authHeader?: string) {
    const token = extractBearer(authHeader);
    let sessionId = body?.sessionId;

    if (!sessionId && !token) {
      return { status: 'logged_out' };
    }

    const service = this.requireService();
    if (!sessionId && token) {
      const session = await service.authenticate(token);
      sessionId = session?.sessionId;
    }

    if (sessionId) {
      await service.logout(sessionId, token);
    }

    return { status: 'logged_out' };
  }

  @ApiOperation({ summary: 'Query authenticated client session details' })
  @ApiBearerAuth('bearer')
  @ApiResponse({ status: 200, description: 'Session details' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @Get('session')
  async session(@Headers('authorization') authHeader?: string) {
    const token = extractBearer(authHeader);
    if (!token) {
      throw new HttpException({ error: 'authentication_required' }, HttpStatus.UNAUTHORIZED);
    }
    const service = this.requireService();
    const session = await service.authenticate(token);
    if (!session) {
      throw new HttpException({ error: 'invalid_credentials' }, HttpStatus.UNAUTHORIZED);
    }
    const view = await service.getSession(session.sessionId);
    return { session: view };
  }
}
