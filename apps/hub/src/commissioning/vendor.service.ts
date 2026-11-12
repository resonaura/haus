/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  classifyVendorDevice,
  provisionVendorDevice,
  type VendorCandidate,
  type VendorProvisioningOptions,
  type VendorProvisioningResult,
  type WifiCredentials,
} from '@haus/core';

export interface ClassifyCandidateDto {
  readonly host: string;
  readonly port?: number;
  readonly name?: string;
  readonly serviceType?: string;
  readonly txt?: Record<string, string>;
  readonly mac?: string;
  readonly model?: string;
}

export interface ProvisionVendorDto {
  readonly candidate: VendorCandidate;
  readonly ssid: string;
  readonly password: string;
  readonly authUsername?: string;
  readonly authPassword?: string;
  readonly timeoutMs?: number;
}

@Injectable()
export class VendorCommissioningService {
  private readonly logger = new Logger(VendorCommissioningService.name);

  classify(dto: ClassifyCandidateDto): VendorCandidate {
    return classifyVendorDevice(dto);
  }

  async provision(
    dto: ProvisionVendorDto,
    options: VendorProvisioningOptions = {},
  ): Promise<VendorProvisioningResult> {
    const creds: WifiCredentials = {
      ssid: dto.ssid,
      password: dto.password,
    };

    try {
      this.logger.log(
        `Provisioning vendor device ${dto.candidate.vendor} (${dto.candidate.protocol}) at ${dto.candidate.host}`,
      );

      const res = await provisionVendorDevice(dto.candidate, creds, {
        timeoutMs: dto.timeoutMs ?? options.timeoutMs ?? 10000,
        fetchFn: options.fetchFn,
        authUsername: dto.authUsername,
        authPassword: dto.authPassword,
      });

      return res;
    } finally {
      (creds as { password?: string }).password = '';
    }
  }
}
