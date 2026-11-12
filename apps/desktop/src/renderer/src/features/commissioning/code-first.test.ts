/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommissioningTransaction } from '@haus/core';
import { detectSetupCode } from './protocol-detect.js';

// Hoisted mock state for hook testing without explicit any
const mockState = vi.hoisted(() => ({
  restRequests: [] as Array<{ method: string; path: string; data?: unknown }>,
  mockRestHandler: ((_method: string, _path: string, _data?: unknown) =>
    Promise.resolve({})) as (
    method: string,
    path: string,
    data?: unknown,
  ) => Promise<unknown>,
}));

vi.mock('../../ha/management', () => ({
  rest: (method: string, path: string, data?: unknown) => {
    mockState.restRequests.push({ method, path, data });
    return mockState.mockRestHandler(method, path, data);
  },
}));

// Typed minimal hook runner
type HookSlot = {
  value?: unknown;
  current?: unknown;
  callback?: unknown;
  deps?: unknown[];
  cleanup?: (() => void) | undefined;
};

const hookRunner = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as HookSlot[],
  effects: [] as Array<() => void>,
  reset() {
    this.cursor = 0;
    this.slots = [];
    this.effects = [];
  },
  rewind() {
    this.cursor = 0;
  },
}));

vi.mock('react', () => ({
  useState<T>(initial: T | (() => T)): [T, (val: T | ((prev: T) => T)) => void] {
    const idx = hookRunner.cursor++;
    if (!hookRunner.slots[idx]) {
      hookRunner.slots[idx] = {
        value: typeof initial === 'function' ? (initial as () => T)() : initial,
      };
    }
    const slot = hookRunner.slots[idx]!;
    const setter = (val: T | ((prev: T) => T)) => {
      slot.value = typeof val === 'function' ? (val as (prev: T) => T)(slot.value as T) : val;
    };
    return [slot.value as T, setter];
  },
  useRef<T>(initial: T): { current: T } {
    const idx = hookRunner.cursor++;
    if (!hookRunner.slots[idx]) {
      hookRunner.slots[idx] = { current: initial };
    }
    return hookRunner.slots[idx] as { current: T };
  },
  useCallback<T extends (...args: unknown[]) => unknown>(callback: T, deps: unknown[]): T {
    const idx = hookRunner.cursor++;
    const prev = hookRunner.slots[idx];
    if (!prev || !prev.deps || deps.some((d, i) => d !== prev.deps![i])) {
      hookRunner.slots[idx] = { callback, deps };
      return callback;
    }
    return prev.callback as T;
  },
  useEffect(effect: () => (() => void) | void, deps?: unknown[]): void {
    const idx = hookRunner.cursor++;
    const prev = hookRunner.slots[idx];
    if (!prev || !prev.deps || !deps || deps.some((d, i) => d !== prev.deps![i])) {
      const slot: HookSlot = { deps };
      hookRunner.slots[idx] = slot;
      hookRunner.effects.push(() => {
        prev?.cleanup?.();
        const clean = effect();
        if (typeof clean === 'function') slot.cleanup = clean;
      });
    }
  },
}));

import { useCommissioningSession } from './useCommissioningSession.js';

describe('Cross-Platform Code-First Experience', () => {
  beforeEach(() => {
    mockState.restRequests = [];
    hookRunner.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Protocol and Setup Code Detection (detectSetupCode)', () => {
    it('detects Matter QR codes with discriminator', () => {
      const detected = detectSetupCode('MT:Y.K9042C00KA0648G00');
      expect(detected.valid).toBe(true);
      expect(detected.kind).toBe('matter-qr');
      expect(detected.protocol).toBe('matter');
      expect(detected.badgeVariant).toBe('primary');
      const disc = detected.parsed?.matter?.discriminator;
      const discVal = typeof disc === 'object' && disc !== null ? disc.value : disc;
      expect(discVal).toBe(3840);
    });

    it('detects 11-digit Matter manual code with valid Verhoeff checksum', () => {
      const detected = detectSetupCode('34970112332');
      expect(detected.valid).toBe(true);
      expect(detected.kind).toBe('matter-manual');
      expect(detected.protocol).toBe('matter');
      expect(detected.label).toContain('Matter Manual');
    });

    it('rejects Matter manual code with corrupted Verhoeff checksum', () => {
      const detected = detectSetupCode('34970112339');
      expect(detected.valid).toBe(false);
      expect(detected.label).toBe('Matter Checksum Failed');
      expect(detected.error).toBe('Verhoeff checksum failure');
    });

    it('detects valid 8-digit HomeKit PINs (formatted and unformatted)', () => {
      const formatted = detectSetupCode('123-45-679');
      expect(formatted.valid).toBe(true);
      expect(formatted.kind).toBe('homekit-pin');
      expect(formatted.protocol).toBe('homekit');

      const raw = detectSetupCode('12345679');
      expect(raw.valid).toBe(true);
      expect(raw.kind).toBe('homekit-pin');
      expect(raw.protocol).toBe('homekit');
    });

    it('rejects banned weak HomeKit PIN patterns per Apple HomeKit specification', () => {
      for (const banned of ['000-00-000', '111-11-111', '123-45-678', '876-54-321']) {
        const detected = detectSetupCode(banned);
        expect(detected.valid).toBe(false);
        expect(detected.label).toBe('Weak HomeKit PIN');
        expect(detected.error).toContain('banned weak PIN pattern');
      }
    });

    it('detects HomeKit setup URI (X-HM://)', () => {
      const detected = detectSetupCode('X-HM://0023IS0FY39NJ');
      expect(detected.valid).toBe(true);
      expect(detected.kind).toBe('homekit-uri');
      expect(detected.protocol).toBe('homekit');
      expect(detected.parsed?.homekit?.setupId).toBe('39NJ');
    });

    it('detects Improv provisioning identifiers', () => {
      const detected = detectSetupCode('improv:esp32-living-room');
      expect(detected.valid).toBe(true);
      expect(detected.kind).toBe('improv');
      expect(detected.protocol).toBe('improv');
    });

    it('detects supported documented vendor prefixes (Shelly, ESPHome, Tasmota)', () => {
      for (const prefix of ['shelly-plus-1pm', 'esphome-sensor', 'tasmota-plug']) {
        const detected = detectSetupCode(prefix);
        expect(detected.valid).toBe(true);
        expect(detected.kind).toBe('vendor');
        expect(detected.protocol).toBe('vendor');
      }
    });

    it('truthfully handles proprietary Aqara protocols with honest guidance and zero fake success', () => {
      const detected = detectSetupCode('aqara:proprietary-hub-v1');
      expect(detected.valid).toBe(false);
      expect(detected.kind).toBe('unsupported_proprietary');
      expect(detected.label).toBe('Proprietary Aqara protocol');
      expect(detected.honestLimitation).toContain('Haus uses open, local-first protocols');
      expect(detected.honestLimitation).toContain('Matter pairing mode');
    });

    it('flags incomplete or ambiguous numeric input during live typing', () => {
      const incomplete = detectSetupCode('1234');
      expect(incomplete.valid).toBe(false);
      expect(incomplete.kind).toBe('incomplete');
      expect(incomplete.description).toContain('HomeKit PIN requires 8 digits');

      const typingMatter = detectSetupCode('123456789');
      expect(typingMatter.valid).toBe(false);
      expect(typingMatter.kind).toBe('incomplete');
      expect(typingMatter.label).toBe('Incomplete Matter Code');

      const ambiguous = detectSetupCode('1234567890123');
      expect(ambiguous.valid).toBe(false);
      expect(ambiguous.kind).toBe('ambiguous');
    });
  });

  describe('Commissioning Session Lifecycle (useCommissioningSession)', () => {
    it('manages start, discovery, candidate selection, credentials, and completion', async () => {
      const mockTx: CommissioningTransaction = {
        commissioningId: 'tx-matter-001',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        state: 'SELECT_CANDIDATE',
        parsedCode: { kind: 'matter-qr', raw: '', protocol: 'matter' },
        candidates: [
          {
            agentId: 'hub',
            transport: 'lan',
            protocol: 'matter',
            identifier: 'cand-001',
            name: 'Matter Smart Plug',
            address: '192.168.1.50',
            port: 5540,
          },
        ],
        events: [
          {
            seq: 1,
            timestamp: Date.now(),
            type: 'commission.create',
            state: 'PARSE_CODE',
            message: 'Session started',
          },
        ],
      };

      mockState.mockRestHandler = vi.fn(async (method, path) => {
        if (method === 'POST' && path === 'commissioning/sessions') {
          return mockTx;
        }
        if (method === 'POST' && path === 'commissioning/sessions/tx-matter-001/select') {
          return {
            ...mockTx,
            state: 'OBTAIN_NETWORK_CREDENTIALS',
            requiresCredentials: {
              kind: 'wifi',
              suggestedSsid: 'HausHome_2G',
              reason: 'Wi-Fi connection required',
            },
          };
        }
        if (method === 'POST' && path === 'commissioning/sessions/tx-matter-001/credentials') {
          return {
            ...mockTx,
            state: 'DONE',
            events: [
              ...mockTx.events,
              {
                seq: 2,
                timestamp: Date.now(),
                type: 'network.provisioned',
                state: 'DONE',
                message: 'Device commissioned successfully',
              },
            ],
          };
        }
        return mockTx;
      });

      // 1. Initial render
      hookRunner.rewind();
      let session = useCommissioningSession('MT:Y.K9042C00KA0648G00');
      expect(session.stage).toBe('code_entry');
      expect(session.detected.valid).toBe(true);

      // 2. Start commissioning
      await session.startCommissioning();
      expect(mockState.restRequests[0]).toEqual({
        method: 'POST',
        path: 'commissioning/sessions',
        data: {
          code: 'MT:Y.K9042C00KA0648G00',
          contextProtocol: 'matter',
        },
      });

      hookRunner.rewind();
      session = useCommissioningSession('MT:Y.K9042C00KA0648G00');
      expect(session.stage).toBe('candidate_selection');
      expect(session.candidates).toHaveLength(1);
      expect(session.candidates[0]!.name).toBe('Matter Smart Plug');

      // 3. Select candidate
      await session.selectCandidate('cand-001');
      hookRunner.rewind();
      session = useCommissioningSession('MT:Y.K9042C00KA0648G00');
      expect(session.stage).toBe('credentials');
      expect(session.promptCredentials?.suggestedSsid).toBe('HausHome_2G');

      // 4. Submit credentials
      await session.submitCredentials('HausHome_2G', 'secretPass', undefined, true);
      hookRunner.rewind();
      session = useCommissioningSession('MT:Y.K9042C00KA0648G00');
      expect(session.stage).toBe('complete');
      expect(session.events).toHaveLength(2);
    });

    it('maps failure codes to actionable user guidance', async () => {
      mockState.mockRestHandler = vi.fn(async () => {
        throw new Error('deadline_exceeded: pairing window closed');
      });

      hookRunner.rewind();
      const session = useCommissioningSession('123-45-679');
      await session.startCommissioning();

      hookRunner.rewind();
      const afterFail = useCommissioningSession('123-45-679');
      expect(afterFail.stage).toBe('error');
      expect(afterFail.errorMessage).toContain('deadline_exceeded');
      expect(afterFail.actionableHint).toContain('Power cycle the device or press its setup button');
    });

    it('cancels active session cleanly and clears polling', async () => {
      mockState.mockRestHandler = vi.fn(async (method, path) => {
        if (method === 'POST' && path === 'commissioning/sessions') {
          return {
            commissioningId: 'sess-to-cancel',
            state: 'LAN_DISCOVERY',
            events: [],
            candidates: [],
          };
        }
        if (method === 'POST' && path === 'commissioning/sessions/sess-to-cancel/cancel') {
          return { status: 'cancelled' };
        }
        return {};
      });

      hookRunner.rewind();
      const session = useCommissioningSession('123-45-679');
      await session.startCommissioning();

      await session.cancelCommissioning();
      expect(mockState.restRequests.some((r) => r.path.endsWith('/cancel'))).toBe(true);

      hookRunner.rewind();
      const afterCancel = useCommissioningSession('123-45-679');
      expect(afterCancel.stage).toBe('code_entry');
      expect(afterCancel.transaction).toBeNull();
    });
  });
});
