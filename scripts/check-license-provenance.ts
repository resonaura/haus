/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_PKG_LICENSES: Readonly<Record<string, string>> = {
  '@haus/kitsune': 'GPL-3.0-only',
  default: 'GPL-3.0-or-later',
};

const FORBIDDEN_DEPENDENCIES = ['@scrypted/server', '@scrypted/sdk', 'scrypted'] as const;

const IGNORED_DIRS = new Set([
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'out',
  '.git',
  '.turbo',
  'coverage',
  '.gemini',
  '.local',
]);

interface PackageManifest {
  name: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        results.push(...collectSourceFiles(path.join(dir, entry.name)));
      }
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

function verifyPackages(): {
  issues: string[];
  packages: Array<{ name: string; path: string; data: PackageManifest }>;
} {
  const issues: string[] = [];
  const dirs = ['apps', 'packages'];
  const packages: Array<{ name: string; path: string; data: PackageManifest }> = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const pkgPath = path.join(dir, entry, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as PackageManifest;
        packages.push({ name: pkg.name, path: pkgPath, data: pkg });
      }
    }
  }

  for (const { name, path: pkgPath, data } of packages) {
    const expectedLicense = ALLOWED_PKG_LICENSES[name] ?? ALLOWED_PKG_LICENSES.default;
    if (data.license !== expectedLicense) {
      issues.push(
        `Package ${name} (${pkgPath}) license is "${String(data.license)}", expected "${String(expectedLicense)}"`,
      );
    }

    const allDeps: Record<string, string | undefined> = {
      ...data.dependencies,
      ...data.devDependencies,
      ...data.peerDependencies,
    };

    for (const forbidden of FORBIDDEN_DEPENDENCIES) {
      if (allDeps[forbidden]) {
        issues.push(`Package ${name} includes forbidden dependency: ${forbidden}`);
      }
    }
  }

  return { issues, packages };
}

function verifySourceHeaders(): { issues: string[]; fileCount: number } {
  const issues: string[] = [];
  const sourceFiles = [
    ...collectSourceFiles('packages'),
    ...collectSourceFiles('apps'),
    ...collectSourceFiles('scripts'),
  ];

  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8').slice(0, 500);
    const hasCopyright = content.includes('Copyright ©') || content.includes('Copyright (c)');
    const hasSpdx = content.includes('SPDX-License-Identifier: GPL-3.0');

    if (!hasCopyright || !hasSpdx) {
      issues.push(`Source file missing GPL copyright header: ${file}`);
    }
  }

  return { issues, fileCount: sourceFiles.length };
}

export function runLicenseCheck(): void {
  const { issues: pkgIssues, packages } = verifyPackages();
  const { issues: headerIssues, fileCount } = verifySourceHeaders();
  const allIssues = [...pkgIssues, ...headerIssues];

  if (allIssues.length > 0) {
    console.error('❌ License and provenance check failed:');
    for (const issue of allIssues) {
      console.error(`  - ${issue}`);
    }
    process.exit(1);
  }

  console.log(`✓ License and provenance verification passed:`);
  console.log(`  - Verified ${packages.length} workspace packages with strict GPL compliance.`);
  console.log(`  - Verified GPL headers across all ${fileCount} authored source files.`);
  console.log(`  - Verified zero forbidden proprietary or Scrypted runtime dependencies.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  runLicenseCheck();
}
