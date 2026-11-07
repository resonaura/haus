/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
export function required<T>(value: T | null | undefined): T { assert.ok(value !== null && value !== undefined, 'expected fixture value'); return value; }
