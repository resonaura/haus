/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Inject, Injectable } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import type { Server as WsServer } from 'ws';
import { LIVE_SERVICE } from './tokens.js';
import type { LiveService } from './types.js';

@Injectable()
@WebSocketGateway({ path: '/api/live' })
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: WsServer;

  constructor(@Inject(LIVE_SERVICE) private readonly liveService: LiveService) {}

  handleConnection(client: WebSocket, req: IncomingMessage): void {
    if (
      req.headers['x-haus-client'] !== '1' ||
      !this.liveService.authorize(req.headers.authorization) ||
      this.liveService.getClientCount() >= 32
    ) {
      client.close(1008, 'Unauthorized');
      return;
    }

    client.on('message', () => {
      client.close(1008, 'Read-only channel');
    });

    this.liveService.addClient(client);

    const initialState = this.liveService.getState('home');
    try {
      client.send(JSON.stringify(initialState));
    } catch {
      client.terminate();
      this.liveService.removeClient(client);
    }
  }

  handleDisconnect(client: WebSocket): void {
    this.liveService.removeClient(client);
  }
}
