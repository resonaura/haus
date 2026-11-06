/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** An omitted setting preserves existing NVR installs; an explicit empty setting monitors only. */
export function nodeRoles(value) {
  if (value === undefined) return ["storage", "stream"];
  if (typeof value !== "string") throw new Error("Invalid roles");
  if (!value.trim()) return [];
  const roles = value.split(",").map((role) => role.trim());
  if (roles.some((role) => !["storage", "stream"].includes(role)))
    throw new Error("Invalid roles");
  return [...new Set(roles)];
}
