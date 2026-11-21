/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Inline Node scripts executed inside target containers to handle symlinks & verification safely. */

export const CHECKSUM_SCAN_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = {};
for (const rel of input.paths) {
  const full = path.join(input.appDir, rel);
  try {
    const buf = fs.readFileSync(full);
    out[rel] = crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    out[rel] = null;
  }
}
process.stdout.write(JSON.stringify(out));
`;

export const BACKUP_STAGE_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const tmpDir = '/tmp/haus-deploy-backup-' + input.backupId;
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });
const existingFiles = [];
const addedFiles = [];
for (const rel of input.paths) {
  const src = path.join(input.appDir, rel);
  if (fs.existsSync(src)) {
    const dst = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    existingFiles.push(rel);
  } else {
    addedFiles.push(rel);
  }
}
process.stdout.write(JSON.stringify({ existingFiles, addedFiles }));
`;

export const APPLY_AND_VERIFY_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const cfg = JSON.parse(fs.readFileSync(0, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(cfg.stageDir, '.haus-deploy-manifest.json'), 'utf8'));
const touchedDirs = new Set();
const jsFiles = [];
const pyFiles = [];

for (const item of manifest.files) {
  const src = path.join(cfg.stageDir, item.relPath);
  const dst = path.join(cfg.appDir, item.relPath);
  const dir = path.dirname(dst);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = dst + '.haus-tmp';
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dst);
  touchedDirs.add(dir);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(dst)).digest('hex');
  if (actual !== item.sha256) {
    throw new Error('sha256_mismatch:' + item.relPath);
  }
  if (item.relPath.endsWith('.js') || item.relPath.endsWith('.mjs')) jsFiles.push(dst);
  if (item.relPath.endsWith('.py')) pyFiles.push(dst);
}

for (const dir of touchedDirs) {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('._')) fs.rmSync(path.join(dir, name), { force: true });
    }
  } catch {}
}

if (cfg.chown) {
  for (const item of manifest.files) {
    const dst = path.join(cfg.appDir, item.relPath);
    spawnSync('chown', [cfg.chown, dst], { stdio: 'pipe' });
  }
}

for (const js of jsFiles) {
  const chk = spawnSync(process.execPath, ['--check', js], { encoding: 'utf8' });
  if (chk.status !== 0) {
    throw new Error('node_syntax_error:' + js + ':' + (chk.stderr || chk.stdout));
  }
}

if (pyFiles.length > 0) {
  if (!cfg.pythonBin) throw new Error('python_missing_for_py_compile');
  const py = spawnSync(cfg.pythonBin, ['-m', 'py_compile', ...pyFiles], { encoding: 'utf8' });
  if (py.status !== 0) {
    throw new Error('py_compile_error:' + (py.stderr || py.stdout));
  }
}

fs.rmSync(cfg.stageDir, { recursive: true, force: true });
process.stdout.write(JSON.stringify({ applied: manifest.files.length, jsChecked: jsFiles.length, pyChecked: pyFiles.length }));
`;

export const PATCH_NEST_BODY_PARSER_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const nestPath = path.join(process.argv[1], 'dist/nest.js');
let src = fs.readFileSync(nestPath, 'utf8');
if (src.includes("useBodyParser('json', { limit: '16mb' })")) {
  process.stdout.write('unchanged');
  process.exit(0);
}
const updated = src
  .replace(/rawBody:\\s*true\\s*\\}/, 'rawBody: true, bodyParser: false }')
  .replace(
    /(app\\.connectMicroservice[^\\n]*\\n)/,
    "$1    app.useBodyParser('json', { limit: '16mb' });\\n    app.useBodyParser('urlencoded', { limit: '16mb', extended: true });\\n",
  );
if (updated === src) {
  throw new Error('nest_body_parser_anchor_not_found');
}
fs.writeFileSync(nestPath, updated, 'utf8');
const chk = spawnSync(process.execPath, ['--check', nestPath], { encoding: 'utf8' });
if (chk.status !== 0) {
  fs.writeFileSync(nestPath, src, 'utf8');
  throw new Error('nest_patch_syntax_error:' + (chk.stderr || chk.stdout));
}
process.stdout.write('patched');
`;

export const RESTORE_BACKUP_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cfg = JSON.parse(fs.readFileSync(0, 'utf8'));
for (const rel of cfg.existingFiles) {
  const src = path.join(cfg.restoreDir, rel);
  const dst = path.join(cfg.appDir, rel);
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const tmp = dst + '.haus-tmp';
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dst);
    if (cfg.chown) spawnSync('chown', [cfg.chown, dst], { stdio: 'pipe' });
  }
}
for (const rel of cfg.addedFiles) {
  fs.rmSync(path.join(cfg.appDir, rel), { force: true });
}
fs.rmSync(cfg.restoreDir, { recursive: true, force: true });
`;
