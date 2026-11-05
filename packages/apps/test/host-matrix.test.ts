/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  evaluateAllHardwareMatrices,
  evaluateHardwareHostMatrix,
  HardwareClass,
  HostOsTarget,
} from '../src/index.js';

describe('P6.4: Target Host OS & Hardware Evaluation Matrix', () => {
  it('evaluates Intel/AMD x86_64 Mini PC and Black Laptop class', () => {
    const comparison = evaluateHardwareHostMatrix(HardwareClass.IntelAmd64MiniPc);

    expect(comparison.hardware).toBe(HardwareClass.IntelAmd64MiniPc);
    expect(comparison.recommendedTarget).toBe(HostOsTarget.DebianUbuntuDocker);
    expect(comparison.standaloneLinuxProven).toBe(true);

    const debianProfile = comparison.profiles.find((p) => p.os === HostOsTarget.DebianUbuntuDocker);
    expect(debianProfile).toBeDefined();
    expect(debianProfile!.recommended).toBe(true);
    expect(debianProfile!.standaloneCapable).toBe(true);
    expect(debianProfile!.overallScore).toBeGreaterThanOrEqual(9.5);

    // Verify Intel QuickSync and storage direct access
    expect(debianProfile!.storage.score).toBe(10);
    expect(debianProfile!.storage.directHardwareAccess).toBe(true);
    expect(debianProfile!.hardwareAcceleration.score).toBe(10);
    expect(debianProfile!.hardwareAcceleration.directHardwareAccess).toBe(true);
    expect(debianProfile!.multicast.score).toBe(10);
    expect(debianProfile!.radios.score).toBe(10);

    // Verify HAOS profile has lower scores and is not recommended
    const haosProfile = comparison.profiles.find((p) => p.os === HostOsTarget.HaosHost);
    expect(haosProfile).toBeDefined();
    expect(haosProfile!.recommended).toBe(false);
    expect(haosProfile!.standaloneCapable).toBe(false);
    expect(haosProfile!.overallScore).toBeLessThan(7.0);
    expect(haosProfile!.storage.directHardwareAccess).toBe(false);
  });

  it('evaluates Raspberry Pi 4/5 arm64 hardware class', () => {
    const comparison = evaluateHardwareHostMatrix(HardwareClass.RaspberryPiArm64);

    expect(comparison.hardware).toBe(HardwareClass.RaspberryPiArm64);
    expect(comparison.recommendedTarget).toBe(HostOsTarget.DebianUbuntuDocker);
    expect(comparison.standaloneLinuxProven).toBe(true);

    const debianProfile = comparison.profiles.find((p) => p.os === HostOsTarget.DebianUbuntuDocker);
    expect(debianProfile).toBeDefined();
    expect(debianProfile!.recommended).toBe(true);
    expect(debianProfile!.standaloneCapable).toBe(true);
    expect(debianProfile!.overallScore).toBeGreaterThanOrEqual(9.0);

    // GPIO and radio access
    expect(debianProfile!.radios.score).toBe(10);
    expect(debianProfile!.radios.directHardwareAccess).toBe(true);
    expect(debianProfile!.multicast.score).toBe(10);

    // Alpine profile
    const alpineProfile = comparison.profiles.find((p) => p.os === HostOsTarget.AlpineDocker);
    expect(alpineProfile).toBeDefined();
    expect(alpineProfile!.standaloneCapable).toBe(true);
    expect(alpineProfile!.hardwareAcceleration.limitations.length).toBeGreaterThan(0);
  });

  it('evaluates all hardware matrices in batch', () => {
    const comparisons = evaluateAllHardwareMatrices();

    expect(comparisons).toHaveLength(2);
    expect(comparisons.every((c) => c.standaloneLinuxProven)).toBe(true);
    expect(comparisons.every((c) => c.recommendedTarget === HostOsTarget.DebianUbuntuDocker)).toBe(
      true,
    );
  });
});
