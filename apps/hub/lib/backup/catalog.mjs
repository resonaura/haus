/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";

// Supervisor excludes haus.sqlite* from hot backups, including nested basenames.
export const CATALOG_SNAPSHOT = "catalog.snapshot.sqlite";

export async function restoreCatalog(root) {
  for (const name of [CATALOG_SNAPSHOT, "haus.sqlite"]) {
    try {
      await copyFile(
        join(root, "restore", name),
        join(root, "haus.sqlite"),
        constants.COPYFILE_EXCL,
      );
      return true;
    } catch (error) {
      if (error.code === "EEXIST") return false;
      if (error.code !== "ENOENT") throw error;
    }
  }
  return false;
}
