/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Duplex } from 'node:stream';
import {
  TERMINAL_PROOF_HEADER,
  TERMINAL_TICKET_HEADER,
  validateTerminalTicketResponse,
  type TerminalTicketRequest,
  type TerminalTicketResponse,
} from '@haus/core/protocol';
import { signingKeyFingerprintHex } from '@haus/ipc/crypto';
import { openRawTerminalRelay, type RawTerminalRelayHandle } from '@haus/ipc/server';
import type { ClusterCryptoIdentity } from '../../cluster/crypto/identity.js';
import {
  buildSignedPeerHeaders,
  sendSignedPeerRequest,
  validateClusterPeerUrl,
  type PeerTrustRecord,
} from '../../cluster/crypto/transport.js';

const PEER_TICKET_PATH = '/api/cluster/peer/terminal/ticket';
const PEER_TERMINAL_PATH = '/api/cluster/peer/terminal';

export type PeerRelayHandle = RawTerminalRelayHandle;

export async function requestPeerTerminalTicket(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly homeId: string;
  readonly peerTrust: PeerTrustRecord;
  readonly rawPeerUrl: string;
  readonly request: TerminalTicketRequest;
}): Promise<{ readonly peerUrl: string; readonly response: TerminalTicketResponse }> {
  const logger = new Logger('TerminalRelay');
  const peerUrl = validateClusterPeerUrl(params.rawPeerUrl, true);
  let peerRaw: unknown;
  try {
    peerRaw = await sendSignedPeerRequest({
      identity: params.identity,
      homeId: params.homeId,
      targetHubId: params.peerTrust.hubId,
      targetUrl: peerUrl,
      channelSecret: params.peerTrust.channelSecret,
      method: 'POST',
      path: PEER_TICKET_PATH,
      body: params.request,
      timeoutMs: 8_000,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'peer_terminal_unreachable';
    logger.warn(`Peer terminal ticket request to ${params.peerTrust.hubId} failed: ${reason}`);
    throw new HttpException({ error: reason }, HttpStatus.BAD_GATEWAY);
  }

  let peerResp: TerminalTicketResponse;
  try {
    peerResp = validateTerminalTicketResponse(peerRaw);
  } catch {
    throw new HttpException({ error: 'invalid_peer_terminal_response' }, HttpStatus.BAD_GATEWAY);
  }

  const expectedPeerFingerprint = signingKeyFingerprintHex(params.peerTrust.signingPublicKey);
  if (
    peerResp.targetHubId !== params.peerTrust.hubId ||
    peerResp.homeId !== params.homeId ||
    peerResp.hubSigningPublicKey !== params.peerTrust.signingPublicKey.trim() ||
    peerResp.hubKeyFingerprint !== expectedPeerFingerprint
  ) {
    logger.error(
      `Rejected mismatched peer identity from ${params.peerTrust.hubId} during terminal handshake`,
    );
    throw new HttpException({ error: 'peer_identity_mismatch' }, HttpStatus.BAD_GATEWAY);
  }

  return { peerUrl, response: { ...peerResp, relayed: true } };
}

/**
 * Opens a mutually-authenticated Hub-to-Hub direct raw TCP/TLS IPC tunnel to a peer Hub
 * and pipes opaque E2EE encrypted bytes with TCP_NODELAY and zero frame parsing overhead.
 */
export function openPeerTerminalRelay(params: {
  readonly clientSocket: Duplex;
  readonly clientHead: Buffer;
  readonly identity: ClusterCryptoIdentity;
  readonly homeId: string;
  readonly peerHubId: string;
  readonly peerUrl: string;
  readonly peerChannelSecret?: string;
  readonly ticketId: string;
  readonly clientProof: string;
  readonly checkAuthorized: () => boolean;
  readonly onClosed: () => void;
}): PeerRelayHandle {
  const origin = validateClusterPeerUrl(params.peerUrl, true);
  const headers = {
    ...buildSignedPeerHeaders({
      identity: params.identity,
      recipientHubId: params.peerHubId,
      homeId: params.homeId,
      channelSecret: params.peerChannelSecret,
      method: 'GET',
      path: PEER_TERMINAL_PATH,
    }),
    [TERMINAL_TICKET_HEADER]: params.ticketId,
    [TERMINAL_PROOF_HEADER]: params.clientProof,
  };

  return openRawTerminalRelay({
    clientSocket: params.clientSocket,
    clientHead: params.clientHead,
    origin,
    path: PEER_TERMINAL_PATH,
    headers,
    label: params.peerHubId,
    checkAuthorized: params.checkAuthorized,
    onClosed: params.onClosed,
  });
}
