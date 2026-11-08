/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  analysisCandidates,
  Motion,
  type AnalysisNode,
  type AnalysisNodeHealth,
} from '../../../src/camera/motion/index.js';

function createFixture() {
  const nodes: AnalysisNode[] = ['busy', 'idle'].map((id) => ({
    id,
    name: id,
    url: `https://${id}.invalid`,
    key: `fixture-${id}`,
    enabled: true,
    roles: ['stream'],
  }));
  const health = new Map<string, AnalysisNodeHealth>(
    nodes.map((node) => [
      node.id,
      {
        online: true,
        remote: {
          relayOrigin: 'http://helper.test',
          detectors: { supported: true, active: 0, max: 2 },
          resources: {
            cpu: node.id === 'busy' ? 0.8 : 0.1,
            memoryBytes: 1024,
            memoryUsedBytes: 100,
            pressured: false,
          },
          streams: { active: 0, max: 2 },
        },
      },
    ]),
  );
  const motion = new Motion({
    cluster: { nodes: () => nodes, health },
    config: { recording_enabled: true },
    warm: { leases: new Map() },
    recorder: {},
  });
  const rank = () =>
    analysisCandidates(nodes, health, motion.jobs, motion.cooldowns, 1000).map((n) => n.id);
  return { nodes, health, motion, rank };
}

describe('motion placement and processor status', () => {
  it('selects the least loaded eligible analysis node using CPU, memory and reserved slots', () => {
    const { nodes, health, motion, rank } = createFixture();
    expect(rank()).toEqual(['idle', 'busy']);
    health.get('idle')!.remote!.resources!.memoryUsedBytes = 840;
    expect(rank()).toEqual(['busy', 'idle']);
    health.get('idle')!.remote!.resources!.memoryUsedBytes = 100;
    const idle = nodes.find((node) => node.id === 'idle');
    if (!idle) throw Error('missing idle fixture');
    motion.jobs.set('camera.one', { node: idle });
    motion.jobs.set('camera.two', { node: idle });
    expect(rank()).toEqual(['busy']);
    motion.jobs.clear();
    health.get('idle')!.remote!.detectors!.active = 2;
    expect(rank()).toEqual(['busy']);
  });

  it('counts whole-host CPU and PSI pressure even with idle container quota', () => {
    const { health, rank } = createFixture();
    health.get('idle')!.remote!.host = { cpu: { usage: 0.99 } };
    expect(rank()).toEqual(['busy', 'idle']);
    health.get('idle')!.remote!.resources!.analysisPressured = true;
    expect(rank()).toEqual(['busy']);
  });

  it('does not report fresh decoded frames before model calibration', () => {
    const { motion } = createFixture();
    const now = Date.now();
    motion.now = () => now;
    const worker = { state: 'running', lastResult: now, calibrated: false, stop: () => {} };
    motion.jobs.set('camera.test', { local: true, worker });
    expect(motion.status('camera.test').fresh).toBe(false);
    worker.calibrated = true;
    expect(motion.status('camera.test').fresh).toBe(true);
  });

  it('ignores disabled, storage-only, offline, pressured, unsupported and cooling-down nodes', () => {
    const { nodes, health, motion, rank } = createFixture();
    for (const mutate of [
      () => {
        nodes[1]!.enabled = false;
      },
      () => {
        nodes[1]!.roles = ['storage'];
      },
      () => {
        health.get('idle')!.online = false;
      },
      () => {
        health.get('idle')!.remote!.resources!.pressured = true;
      },
      () => {
        health.get('idle')!.remote!.detectors!.supported = false;
      },
      () => {
        health.get('idle')!.remote!.detectors!.max = 0;
      },
      () => {
        motion.cooldowns.set('idle', 1500);
      },
    ]) {
      mutate();
      expect(rank()).toEqual(['busy']);
      nodes[1]!.enabled = true;
      nodes[1]!.roles = ['stream'];
      health.get('idle')!.online = true;
      health.get('idle')!.remote!.resources!.pressured = false;
      health.get('idle')!.remote!.detectors = {
        supported: true,
        active: 0,
        max: 2,
      };
      motion.cooldowns.clear();
    }
    health.get('busy')!.remote!.resources!.cpu = 0.1;
    health.get('idle')!.remote!.streams!.active = 2;
    expect(rank()).toEqual(['busy', 'idle']);
  });

  it('reports the prospective and actual processor while analysis stays opt-in', () => {
    const { nodes, motion } = createFixture();
    motion.sync([
      {
        id: 'camera.test',
        enabled: true,
        available: true,
        motionDetection: { enabled: false, mode: 'objects' },
      },
    ]);
    expect(motion.status('camera.test')).toEqual({
      fresh: false,
      state: 'off',
      processor: 'idle',
      placement: 'nvr',
    });
    motion.jobs.set('camera.test', {
      local: true,
      worker: { state: 'running', stop: () => {} },
    });
    expect(motion.status('camera.test').placement).toBe('home');
    expect(motion.status('camera.test').processor).toBe('Home Assistant');
    motion.jobs.clear();
    nodes.length = 0;
    motion.localSupported = true;
    motion.capacity = { detectors: 1, pressured: false };
    expect(motion.status('camera.test')).toEqual({
      fresh: false,
      state: 'off',
      processor: 'Home Assistant',
      placement: 'home',
      fallbackReason: 'no_nodes',
    });
    motion.capacity.pressured = true;
    expect(motion.status('camera.test').blocked).toBe('capacity');
    motion.localSupported = false;
    expect(motion.status('camera.test').blocked).toBe('unsupported');
    expect(motion.jobs.size).toBe(0);
  });

  it('distinguishes unavailable nodes from a full cluster', () => {
    const { nodes, health, motion } = createFixture();
    nodes.forEach((node) => {
      health.get(node.id)!.online = false;
    });
    expect(motion.status('camera.test').fallbackReason).toBe('nodes_unavailable');
    nodes.forEach((node) => {
      health.get(node.id)!.online = true;
      health.get(node.id)!.remote!.detectors!.active = 2;
    });
    expect(motion.status('camera.test').fallbackReason).toBe('nodes_busy');
    nodes.forEach((node) => {
      node.roles = ['storage'];
    });
    expect(motion.status('camera.test').fallbackReason).toBe('no_analysis_nodes');
  });

  it('releases disabled remote assignments and pauses an overloaded local fallback', async () => {
    const { nodes, motion } = createFixture();
    let at = 1000;
    let stopped = 0;
    motion.now = () => at;
    motion.config.recording_enabled = true;
    motion.localSupported = true;
    motion.capacity = {
      detectors: 1,
      pressured: true,
      memoryUsed: 800,
      memory: 1024,
    };
    motion.sync([
      {
        id: 'camera.test',
        enabled: true,
        available: true,
        motionDetection: { enabled: true, mode: 'objects' },
      },
    ]);
    nodes.forEach((node) => {
      node.enabled = false;
    });
    motion.jobs.set('camera.test', {
      local: true,
      mode: 'objects',
      worker: {
        state: 'running',
        stop: async () => {
          stopped++;
        },
      },
    });
    await motion.tick();
    expect(stopped).toBe(0);
    at += 21000;
    await motion.tick();
    expect(stopped).toBe(1);
    expect(motion.jobs.size).toBe(0);
    // A disabled node must release its active assignment before its remote API is polled.
    let released: string | undefined;
    motion.release = async (id: string) => {
      released = id;
      motion.jobs.delete(id);
    };
    motion.jobs.set('camera.test', { node: nodes[0], mode: 'objects' });
    await motion.tick();
    expect(released).toBe('camera.test');
  });
});
