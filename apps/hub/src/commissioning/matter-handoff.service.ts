/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  MatterHandoffManager,
  type MatterHandoffRequest,
  type MatterHandoffSession,
} from '@haus/matter';
import { MatterService } from '../matter/service.js';
import { CommissioningService } from './service.js';

@Injectable()
export class MatterHandoffService {
  private readonly logger = new Logger(MatterHandoffService.name);
  private readonly manager = new MatterHandoffManager();

  constructor(
    @Optional() private readonly matterService?: MatterService,
    @Optional() private readonly commissioningService?: CommissioningService,
  ) {}

  public initiateHandoff(req: MatterHandoffRequest): MatterHandoffSession {
    this.logger.log(
      `Initiating Matter handoff for session ${req.commissioningId} from temporary commissioner ${req.temporaryCommissionerId}`,
    );
    const session = this.manager.createSession(req);
    return session;
  }

  public async executeHubCommissioning(handoffId: string): Promise<MatterHandoffSession> {
    const transport = this.matterService?.transport;
    if (!transport) {
      throw new Error('matter_server_not_configured');
    }

    this.logger.log(`Executing Hub permanent commissioning for handoff ${handoffId}`);
    const session = await this.manager.executeHubCommissioning(handoffId, transport);

    // Refresh nodes in MatterService so newly commissioned node is registered in inventory
    if (this.matterService) {
      try {
        await this.matterService.refreshNodes();
      } catch (err) {
        this.logger.warn(`Failed to refresh Matter nodes after commissioning: ${err}`);
      }
    }

    return session;
  }

  public async removeTemporaryFabric(
    handoffId: string,
  ): Promise<{ removed: boolean; uncertain: boolean }> {
    const transport = this.matterService?.transport;
    if (!transport) {
      throw new Error('matter_server_not_configured');
    }

    this.logger.log(`Removing temporary fabric for handoff ${handoffId}`);
    return this.manager.removeTemporaryFabric(handoffId, transport);
  }

  public reopenWindow(
    handoffId: string,
    newExpiresAt: number,
    newPasscode?: number,
    newDiscriminator?: number,
  ): MatterHandoffSession {
    this.logger.log(`Reopening commissioning window for handoff ${handoffId}`);
    return this.manager.reopenWindow(handoffId, newExpiresAt, newPasscode, newDiscriminator);
  }

  public getSession(handoffId: string): MatterHandoffSession | undefined {
    return this.manager.getSession(handoffId);
  }
}
