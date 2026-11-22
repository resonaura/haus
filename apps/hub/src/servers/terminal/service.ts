/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ClientSession } from '@haus/core/auth';
import {
  TERMINAL_IPC_UPGRADE,
  TERMINAL_PROOF_HEADER,
  TERMINAL_TICKET_HEADER,
  validateTerminalTicketRequest,
  type TerminalTicketResponse,
} from '@haus/core/protocol';
import { createServerTerminalHandshake } from '@haus/ipc/crypto';
import {
  startLocalTerminalSession,
  TerminalRateLimitError,
  TerminalTicketStore,
  type ActiveLocalTerminalSession,
  type PendingLocalTicket,
  type PendingTerminalTicket,
} from '@haus/ipc/server';
import type { HubAuthService } from '../../auth/service.js';
import { HUB_AUTH_SERVICE } from '../../auth/tokens.js';
import { CLUSTER_SERVICE, type IClusterService } from '../../cluster/cluster.controller.js';
import type { Cluster } from '../../cluster/cluster.js';
import { ClusterStateStore } from '../../cluster/coordination/state.js';
import { ClusterCryptoIdentity } from '../../cluster/crypto/identity.js';
import { ClusterPeerVerifier, sha256Hex } from '../../cluster/crypto/transport.js';
import { RECORDING_CLUSTER } from '../../events/tokens.js';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../../home/home.service.js';
import {
  createHubAppRuntimeResolver,
  readUpgradeHeader,
  rejectUpgradeResponse,
} from './helpers.js';
import { openPeerTerminalRelay, requestPeerTerminalTicket, type PeerRelayHandle } from './relay.js';

const CLIENT_IPC_PATH = '/api/servers/terminal';
const PEER_IPC_PATH = '/api/cluster/peer/terminal';
const MAX_LOCAL_SESSIONS = 8;
const MAX_SESSIONS_PER_ADMIN = 4;
const MAX_RELAY_SESSIONS = 8;
const EMPTY_BODY_SHA256 = sha256Hex('');
const PROOF_RE = /^[A-Za-z0-9_-]{32,128}$/;

@Injectable()
export class HubTerminalService implements OnModuleDestroy {
  private readonly logger = new Logger('Terminal');
  private readonly peerVerifier = new ClusterPeerVerifier();
  private readonly tickets = new TerminalTicketStore();
  private readonly localSessions = new Map<string, ActiveLocalTerminalSession>();
  private readonly relaySessions = new Map<string, PeerRelayHandle>();
  private readonly activeAdminSessionValid = new Map<string, boolean>();
  private fallbackIdentity?: ClusterCryptoIdentity;

  constructor(
    @Optional() @Inject(HUB_AUTH_SERVICE) private readonly authService?: HubAuthService,
    @Optional() @Inject(ClusterStateStore) private readonly stateStore?: ClusterStateStore,
    @Optional() @Inject(CLUSTER_SERVICE) private readonly clusterService?: IClusterService,
    @Optional() @Inject(RECORDING_CLUSTER) private readonly recordingCluster?: Cluster,
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
  ) {}

  onModuleDestroy(): void {
    this.closeAll();
  }

  private assertEnabled(): void {
    if (process.env.HAUS_TERMINAL_DISABLED === '1') {
      throw new HttpException({ error: 'terminal_disabled' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private assertRateLimit(bucketKey: string): void {
    try {
      this.tickets.assertRateLimit(bucketKey);
    } catch (error) {
      if (error instanceof TerminalRateLimitError) {
        throw new HttpException({ error: error.code }, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw error;
    }
  }

  private async resolveLocalIdentity(): Promise<{
    readonly hubId: string;
    readonly homeId: string;
    readonly identity: ClusterCryptoIdentity;
  }> {
    if (this.stateStore) {
      const state = await this.stateStore.ensureInitialized();
      return {
        hubId: state.hubId,
        homeId: state.homeId,
        identity: this.stateStore.getIdentitySync(state.hubId),
      };
    }
    const authIdentity = this.authService?.getIdentity();
    const hubId = authIdentity?.hubId ?? 'hub-standalone-01';
    const homeId = authIdentity?.homeId ?? 'home-default';
    if (!this.fallbackIdentity || this.fallbackIdentity.hubId !== hubId) {
      this.fallbackIdentity = ClusterCryptoIdentity.loadOrCreate(hubId);
    }
    return { hubId, homeId, identity: this.fallbackIdentity };
  }

  private resolvePeerUrl(targetHubId: string): string | undefined {
    const clusterNode = this.clusterService?.status().nodes.find((node) => node.id === targetHubId);
    if (clusterNode?.url && clusterNode.enabled !== false) return clusterNode.url;
    const recNode = this.recordingCluster?.status().nodes.find((node) => node.id === targetHubId);
    if (recNode?.url && recNode.enabled !== false) return recNode.url;
    return undefined;
  }

  private countAdminSessions(adminSessionId: string): number {
    let count = 0;
    for (const active of this.localSessions.values()) {
      if (active.adminSessionId === adminSessionId) count += 1;
    }
    return count;
  }

  private isAdminSessionActive(sessionId: string): boolean {
    return Boolean(this.authService) && this.activeAdminSessionValid.get(sessionId) !== false;
  }

  private async refreshAdminSessionValid(sessionId: string): Promise<boolean> {
    if (!this.authService) return false;
    const view = await this.authService.getSession(sessionId);
    const valid = Boolean(view && view.clientRole === 'admin' && view.state === 'active');
    this.activeAdminSessionValid.set(sessionId, valid);
    return valid;
  }

  private parseRequest(rawBody: unknown) {
    try {
      return validateTerminalTicketRequest(rawBody);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_terminal_ticket_request';
      throw new HttpException({ error: code }, HttpStatus.BAD_REQUEST);
    }
  }

  private consumeTicket(
    req: IncomingMessage,
    socket: Duplex,
  ): { readonly ticket: PendingTerminalTicket; readonly proof: string } | undefined {
    const ticketId = readUpgradeHeader(req, TERMINAL_TICKET_HEADER);
    const proof = readUpgradeHeader(req, TERMINAL_PROOF_HEADER);
    if (!ticketId || !proof || !PROOF_RE.test(proof)) {
      rejectUpgradeResponse(socket, 401, 'Unauthorized');
      return undefined;
    }
    const ticket = this.tickets.consume(ticketId);
    if (!ticket) {
      rejectUpgradeResponse(socket, 401, 'Unauthorized');
      return undefined;
    }
    return { ticket, proof };
  }

  /** Issues a short-lived E2EE terminal handshake ticket for an authenticated admin session. */
  async issueClientTicket(
    session: ClientSession | undefined,
    rawBody: unknown,
  ): Promise<TerminalTicketResponse> {
    this.assertEnabled();
    if (!session || session.revoked || session.clientRole !== 'admin') {
      throw new HttpException({ error: 'admin_required' }, HttpStatus.FORBIDDEN);
    }
    this.assertRateLimit(`admin:${session.sessionId}`);
    const request = this.parseRequest(rawBody);
    const { hubId: localHubId, homeId: localHomeId, identity } = await this.resolveLocalIdentity();
    const target = request.target ?? { kind: 'shell' as const };
    let effectiveServerId = request.targetServerId;
    const fallbackLocalId = this.stateStore ? undefined : this.clusterService?.status().id;
    let isLocal =
      effectiveServerId === localHubId ||
      (fallbackLocalId !== undefined && effectiveServerId === fallbackLocalId) ||
      effectiveServerId === 'local' ||
      effectiveServerId === 'local-hub' ||
      effectiveServerId === 'home-assistant';

    // If an App is leased to a trusted cluster peer Hub, route its E2EE logs/exec ticket directly there.
    if (isLocal && (target.kind === 'app-logs' || target.kind === 'app-exec') && this.stateStore) {
      const resolved = await this.homeService?.appManager
        .resolveAppRuntime(session.clientId, target.appId)
        .catch(() => undefined);
      const workloadKey = `app:${resolved?.externalId ?? target.appId}`;
      const ownerHubId = this.stateStore.getWorkloadSync(workloadKey)?.ownerHubId;
      if (ownerHubId && ownerHubId !== localHubId) {
        effectiveServerId = ownerHubId;
        isLocal = false;
      }
    }

    if (isLocal) {
      if (
        this.localSessions.size >= MAX_LOCAL_SESSIONS ||
        this.countAdminSessions(session.sessionId) >= MAX_SESSIONS_PER_ADMIN
      ) {
        throw new HttpException({ error: 'terminal_session_limit' }, HttpStatus.TOO_MANY_REQUESTS);
      }
      const handshake = createServerTerminalHandshake({
        identity,
        homeId: localHomeId,
        request,
        relayed: false,
      });
      this.tickets.set({
        kind: 'local',
        ticketId: handshake.response.ticketId,
        actorId: session.clientId,
        adminSessionId: session.sessionId,
        cols: request.cols,
        rows: request.rows,
        target,
        expiresAt: handshake.response.expiresAt,
        crypto: handshake.crypto,
      });
      this.activeAdminSessionValid.set(session.sessionId, true);
      this.logger.log(
        `Issued direct IPC ${target.kind} ticket for admin ${session.clientId} (session ${session.sessionId.slice(0, 12)})`,
      );
      return handshake.response;
    }

    if (this.relaySessions.size >= MAX_RELAY_SESSIONS) {
      throw new HttpException({ error: 'terminal_session_limit' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const peerTrust = this.stateStore?.getPeerTrustRecord(effectiveServerId);
    if (!peerTrust || peerTrust.revoked || peerTrust.homeId !== localHomeId) {
      throw new HttpException({ error: 'target_peer_untrusted' }, HttpStatus.FORBIDDEN);
    }
    const rawPeerUrl = this.resolvePeerUrl(effectiveServerId);
    if (!rawPeerUrl) {
      throw new HttpException({ error: 'target_server_not_found' }, HttpStatus.NOT_FOUND);
    }
    const { peerUrl, response: peerResp } = await requestPeerTerminalTicket({
      identity,
      homeId: localHomeId,
      peerTrust,
      rawPeerUrl,
      request: { ...request, targetServerId: peerTrust.hubId },
    });
    this.tickets.set({
      kind: 'relay',
      ticketId: peerResp.ticketId,
      adminSessionId: session.sessionId,
      peerHubId: peerTrust.hubId,
      peerUrl,
      peerChannelSecret: peerTrust.channelSecret,
      expiresAt: peerResp.expiresAt,
    });
    this.activeAdminSessionValid.set(session.sessionId, true);
    this.logger.log(
      `Issued E2EE relayed direct IPC ticket for admin ${session.clientId} -> peer ${peerTrust.hubId}`,
    );
    return peerResp;
  }

  /** Issues a short-lived local E2EE terminal ticket requested by a verified cluster peer Hub. */
  async issuePeerTicket(peerHubId: string, rawBody: unknown): Promise<TerminalTicketResponse> {
    this.assertEnabled();
    this.assertRateLimit(`peer:${peerHubId}`);
    if (this.localSessions.size >= MAX_LOCAL_SESSIONS) {
      throw new HttpException({ error: 'terminal_session_limit' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const request = this.parseRequest(rawBody);
    const { hubId: localHubId, homeId: localHomeId, identity } = await this.resolveLocalIdentity();
    if (request.targetServerId !== localHubId) {
      throw new HttpException({ error: 'wrong_terminal_target' }, HttpStatus.BAD_REQUEST);
    }
    const handshake = createServerTerminalHandshake({
      identity,
      homeId: localHomeId,
      request,
      relayed: true,
    });
    const target = request.target ?? { kind: 'shell' as const };
    this.tickets.set({
      kind: 'local',
      ticketId: handshake.response.ticketId,
      actorId: `peer:${peerHubId}`,
      authorizedPeerHubId: peerHubId,
      cols: request.cols,
      rows: request.rows,
      target,
      expiresAt: handshake.response.expiresAt,
      crypto: handshake.crypto,
    });
    this.logger.log(`Issued direct IPC terminal ticket for trusted peer ${peerHubId}`);
    return handshake.response;
  }

  /** Handles direct raw binary IPC HTTP 101 upgrades for /api/servers/terminal and /api/cluster/peer/terminal. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      return false;
    }
    if (pathname !== CLIENT_IPC_PATH && pathname !== PEER_IPC_PATH) return false;
    // Block browser CSWSH: reject any Origin header AND reject standard WebSocket upgrades.
    if (req.headers.origin !== undefined) {
      this.logger.warn(`Rejected terminal IPC upgrade with Origin header on ${pathname}`);
      rejectUpgradeResponse(socket, 403, 'Forbidden');
      return true;
    }
    if (readUpgradeHeader(req, 'upgrade')?.toLowerCase() !== TERMINAL_IPC_UPGRADE) {
      this.logger.warn(`Rejected non-IPC terminal upgrade on ${pathname}`);
      rejectUpgradeResponse(socket, 426, 'Upgrade Required');
      return true;
    }
    if (process.env.HAUS_TERMINAL_DISABLED === '1') {
      rejectUpgradeResponse(socket, 503, 'Service Unavailable');
      return true;
    }
    if (pathname === CLIENT_IPC_PATH) this.handleClientUpgrade(req, socket, head);
    else this.handlePeerUpgrade(req, socket, head);
    return true;
  }

  private handleClientUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const authHeader = readUpgradeHeader(req, 'authorization');
    if (
      readUpgradeHeader(req, 'x-haus-client') !== '1' ||
      !authHeader?.startsWith('Bearer ') ||
      !this.authService
    ) {
      rejectUpgradeResponse(socket, 401, 'Unauthorized');
      return;
    }
    const session = this.authService.verifyToken(authHeader.slice(7).trim());
    if (!session || session.revoked || session.clientRole !== 'admin') {
      rejectUpgradeResponse(socket, 403, 'Forbidden');
      return;
    }
    const consumed = this.consumeTicket(req, socket);
    if (!consumed) return;
    const { ticket, proof } = consumed;

    if (ticket.expiresAt <= Date.now() || ticket.adminSessionId !== session.sessionId) {
      if (ticket.kind === 'local') ticket.crypto.destroy();
      rejectUpgradeResponse(socket, 403, 'Forbidden');
      return;
    }
    if (ticket.kind === 'local') {
      if (!ticket.crypto.verifyClientProof(proof)) {
        ticket.crypto.destroy();
        this.logger.warn(
          `Rejected terminal upgrade: invalid cryptographic proof for ${session.clientId}`,
        );
        rejectUpgradeResponse(socket, 401, 'Unauthorized');
        return;
      }
      if (
        this.localSessions.size >= MAX_LOCAL_SESSIONS ||
        this.countAdminSessions(session.sessionId) >= MAX_SESSIONS_PER_ADMIN
      ) {
        ticket.crypto.destroy();
        rejectUpgradeResponse(socket, 429, 'Too Many Requests');
        return;
      }
      this.attachLocalSession(socket, head, ticket, session.sessionId);
      return;
    }
    if (this.relaySessions.size >= MAX_RELAY_SESSIONS || !this.stateStore) {
      rejectUpgradeResponse(socket, 429, 'Too Many Requests');
      return;
    }
    const state = this.stateStore.getStateSync();
    const identity = this.stateStore.getIdentitySync(state.hubId);
    const relayId = ticket.ticketId;
    const handle = openPeerTerminalRelay({
      clientSocket: socket,
      clientHead: head,
      identity,
      homeId: state.homeId,
      peerHubId: ticket.peerHubId,
      peerUrl: ticket.peerUrl,
      peerChannelSecret: ticket.peerChannelSecret,
      ticketId: ticket.ticketId,
      clientProof: proof,
      checkAuthorized: () => {
        void this.refreshAdminSessionValid(session.sessionId);
        return this.isAdminSessionActive(session.sessionId);
      },
      onClosed: () => {
        this.relaySessions.delete(relayId);
      },
    });
    this.relaySessions.set(relayId, handle);
  }

  private handlePeerUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.stateStore) {
      rejectUpgradeResponse(socket, 503, 'Service Unavailable');
      return;
    }
    const state = this.stateStore.getStateSync();
    const verified = this.peerVerifier.verify({
      localHubId: state.hubId,
      localHomeId: state.homeId,
      method: 'GET',
      path: PEER_IPC_PATH,
      headers: req.headers,
      bodyDigestHex: EMPTY_BODY_SHA256,
      lookupPeer: (hubId) => this.stateStore?.getPeerTrustRecord(hubId),
    });
    if (!verified.ok) {
      this.logger.warn(`Rejected peer terminal upgrade: ${verified.reason}`);
      rejectUpgradeResponse(socket, 403, 'Forbidden');
      return;
    }
    const consumed = this.consumeTicket(req, socket);
    if (!consumed) return;
    const { ticket, proof } = consumed;
    if (
      ticket.kind !== 'local' ||
      ticket.expiresAt <= Date.now() ||
      ticket.authorizedPeerHubId !== verified.peer.hubId ||
      !ticket.crypto.verifyClientProof(proof)
    ) {
      if (ticket.kind === 'local') ticket.crypto.destroy();
      rejectUpgradeResponse(socket, 403, 'Forbidden');
      return;
    }
    if (this.localSessions.size >= MAX_LOCAL_SESSIONS) {
      ticket.crypto.destroy();
      rejectUpgradeResponse(socket, 429, 'Too Many Requests');
      return;
    }
    this.attachLocalSession(socket, head, ticket, undefined, verified.peer.hubId);
  }

  private attachLocalSession(
    socket: Duplex,
    head: Buffer,
    ticket: PendingLocalTicket,
    adminSessionId?: string,
    peerHubId?: string,
  ): void {
    const id = ticket.ticketId;
    const handle = startLocalTerminalSession({
      socket,
      head,
      ticketId: id,
      actorId: ticket.actorId,
      target: ticket.target,
      cols: ticket.cols,
      rows: ticket.rows,
      crypto: ticket.crypto,
      appResolver: createHubAppRuntimeResolver(this.homeService),
      adminSessionId,
      peerHubId,
      checkAuthorized: async () => {
        if (adminSessionId) return this.refreshAdminSessionValid(adminSessionId);
        if (peerHubId && this.stateStore) {
          const peer = this.stateStore.getPeerTrustRecord(peerHubId);
          return Boolean(peer && !peer.revoked);
        }
        return true;
      },
      onClosed: () => {
        this.localSessions.delete(id);
      },
    });
    this.localSessions.set(id, handle);
  }

  closeAll(): void {
    this.tickets.clear();
    for (const session of Array.from(this.localSessions.values())) {
      session.close('hub_shutdown');
    }
    for (const relay of Array.from(this.relaySessions.values())) {
      relay.close('hub_shutdown');
    }
  }
}
