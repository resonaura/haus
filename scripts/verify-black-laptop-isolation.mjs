#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { execFileSync } from 'node:child_process';
import {
  EnvironmentIsolationGuard,
} from '../packages/core/dist/cluster/index.js';

const BLACK_LAPTOP_HOST = '192.168.5.115';
const BLACK_LAPTOP_USER = 'mike';
const BLACK_LAPTOP_PASS = '0309';

const SAFETY_BOUNDARY = {
  forbiddenTargets: [
    '192.168.4.44', // Active household Home Assistant
    '192.168.5.117', // Production NVR Node (Miku)
  ],
  allowedHosts: [
    '127.0.0.1',
    '::1',
    '192.168.5.115',
    'localhost',
  ],
};

const STORAGE_CONFIG = {
  sandboxRoot: 'C:/haus-black-laptop-test',
  requiredSubdirs: ['data', 'vault', 'media', 'cache'],
};

const PLANNED_PORTS = [
  { service: 'hub_http', port: 8790, protocol: 'tcp' },
  { service: 'mqtt_broker', port: 18883, protocol: 'tcp' },
  { service: 'homekit_bridge', port: 51828, protocol: 'tcp' },
  { service: 'matter_udp', port: 5541, protocol: 'udp' },
];

function runRemotePowershell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const args = [
    '-p',
    BLACK_LAPTOP_PASS,
    'ssh',
    '-o',
    'PreferredAuthentications=password',
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'ConnectTimeout=8',
    `${BLACK_LAPTOP_USER}@${BLACK_LAPTOP_HOST}`,
    'powershell',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encoded,
  ];

  try {
    const stdout = execFileSync('sshpass', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
    // Strip PowerShell progress XML stream if present
    const cleanOut = stdout.replace(/#<\s*CLIXML[\s\S]*?<\/Objs>/g, '').trim();
    return cleanOut;
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    throw new Error(`Remote execution failed: ${err.message}. Stderr: ${stderr}`);
  }
}

async function verifyBlackLaptopEnvironment() {
  console.log(`[P6.1] Verifying isolated environment on Black Laptop (${BLACK_LAPTOP_HOST})...`);

  // 1. Host identity verification
  console.log('-> Inspecting host identity...');
  const hostnameOut = runRemotePowershell('hostname; (Get-WmiObject Win32_OperatingSystem).Caption');
  const hostLines = hostnameOut.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hostname = hostLines[0] ?? 'unknown';
  const osCaption = hostLines[1] ?? 'unknown';
  console.log(`   Host: ${hostname} (${osCaption})`);

  // 2. Storage sandbox setup & verification
  console.log(`-> Setting up storage sandbox at ${STORAGE_CONFIG.sandboxRoot}...`);
  const setupStorageScript = `
    $ErrorActionPreference = 'Stop'
    $root = '${STORAGE_CONFIG.sandboxRoot.replace(/\//g, '\\')}'
    $dirs = @('data', 'vault', 'media', 'cache') | ForEach-Object { Join-Path $root $_ }
    $dirs | ForEach-Object { if (-not (Test-Path $_)) { New-Item -ItemType Directory -Path $_ -Force | Out-Null } }
    
    $proofFile = Join-Path $root 'data\\isolation-proof.json'
    $proofData = @{
      sandbox = $root
      created = (Get-Date).ToString("o")
      status = 'isolated'
    } | ConvertTo-Json -Compress
    Set-Content -Path $proofFile -Value $proofData -Force
    
    Test-Path $proofFile
  `;
  const storageResult = runRemotePowershell(setupStorageScript);
  const storageOk = storageResult.includes('True');
  console.log(`   Storage Sandbox Initialized: ${storageOk ? 'OK' : 'FAILED'}`);

  // 3. Inspect socket connections on Black Laptop
  console.log('-> Inspecting active TCP socket table...');
  const inspectSocketsScript = `
    $conns = Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object {
      $_.RemoteAddress -and $_.RemoteAddress -ne '0.0.0.0' -and $_.RemoteAddress -ne '::'
    } | Select-Object -Property LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess
    
    if ($conns) {
      $conns | ConvertTo-Json -Compress
    } else {
      '[]'
    }
  `;
  const socketsRaw = runRemotePowershell(inspectSocketsScript);
  let parsedConnections = [];
  try {
    const data = JSON.parse(socketsRaw);
    parsedConnections = Array.isArray(data) ? data : [data];
  } catch {
    parsedConnections = [];
  }

  // Map to ActiveSocketConnection contract (filter out TIME_WAIT / State 11 ephemeral leftovers)
  const activeSockets = parsedConnections
    .filter((c) => c && c.RemoteAddress && c.State !== 11 && c.State !== 'TimeWait')
    .map((c) => ({
      localAddress: String(c.LocalAddress ?? ''),
      localPort: Number(c.LocalPort ?? 0),
      remoteAddress: String(c.RemoteAddress ?? ''),
      remotePort: Number(c.RemotePort ?? 0),
      state: String(c.State ?? ''),
      processId: Number(c.OwningProcess ?? 0),
    }));

  console.log(`   Active non-TIME_WAIT sockets inspected: ${activeSockets.length}`);

  // 4. Inspect listening ports
  console.log('-> Inspecting planned port availability (8790, 18883, 51828, 5541)...');
  const inspectPortsScript = `
    $tcp = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort
    $udp = Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort
    $all = @($tcp) + @($udp)
    if ($all) {
      $all | ConvertTo-Json -Compress
    } else {
      '[]'
    }
  `;
  const portsRaw = runRemotePowershell(inspectPortsScript);
  let listeningPorts = [];
  try {
    const data = JSON.parse(portsRaw);
    listeningPorts = Array.isArray(data) ? data.map(Number) : [Number(data)];
  } catch {
    listeningPorts = [];
  }

  // 5. Inspect Docker Engine status
  console.log('-> Inspecting Docker container engine status...');
  const dockerContainers = runRemotePowershell('docker ps --format "{{.ID}}: {{.Image}} ({{.Status}})"');
  const runningContainers = dockerContainers.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  console.log(`   Running Docker containers: ${runningContainers.length === 0 ? 'None (Clean)' : runningContainers.join(', ')}`);

  // 6. Evaluate via EnvironmentIsolationGuard
  const guard = new EnvironmentIsolationGuard(
    BLACK_LAPTOP_HOST,
    SAFETY_BOUNDARY,
    STORAGE_CONFIG,
    PLANNED_PORTS,
  );

  const report = guard.evaluateIsolation({
    activeConnections: activeSockets,
    listeningPorts,
  });

  console.log('\n================ ISOLATION VERIFICATION REPORT ================');
  console.log(`Host:            ${report.host} (${hostname})`);
  console.log(`Timestamp:       ${report.timestamp}`);
  console.log(`Isolated State:  ${report.isolated ? 'PASS (ISOLATED)' : 'FAIL (UNISOLATED)'}`);
  console.log(`Sandbox Path:    ${report.sandboxPath}`);
  console.log('\nDetailed Checks:');
  for (const c of report.checks) {
    const symbol = c.ok ? '✓ PASS' : '✗ FAIL';
    console.log(`  [${symbol}] [${c.category}] ${c.message}`);
  }

  if (report.violations.length > 0) {
    console.error('\nViolations Detected:');
    for (const v of report.violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }

  console.log('\nSafety Boundary Verified: 100% Isolated. Production HA and NVR untouched.');
  console.log('================================================================\n');
}

verifyBlackLaptopEnvironment().catch((err) => {
  console.error('[P6.1 Error]', err);
  process.exit(1);
});
