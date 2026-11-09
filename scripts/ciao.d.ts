/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
declare module '@homebridge/ciao' {
  export interface CiaoServiceOptions {
    name: string;
    type: string;
    port: number;
    txt?: Record<string, string>;
    restrictedAddresses?: string[];
    disabledIpv6?: boolean;
  }
  export interface CiaoService {
    advertise(): Promise<void>;
  }
  export interface CiaoResponder {
    createService(options: CiaoServiceOptions): CiaoService;
    shutdown(): Promise<void>;
  }
  export function getResponder(): CiaoResponder;
}
