/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { TerminalTarget } from '../protocol/terminal-target.js';
import type { ServerServiceRow } from './servers.js';

export interface TerminalSearchOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

export interface TerminalSearchMatch {
  readonly lineIndex: number;
  readonly start: number;
  readonly end: number;
  readonly line: string;
}

export interface TerminalSearchResult {
  readonly matches: readonly TerminalSearchMatch[];
  readonly matchingLineIndices: readonly number[];
  readonly error?: string;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function searchTerminalOutput(
  output: string,
  query: string,
  options: TerminalSearchOptions,
): TerminalSearchResult {
  if (!query) return { matches: [], matchingLineIndices: [] };
  const basePattern = options.regex ? query : escapeRegExp(query);
  const pattern = options.wholeWord ? `\\b(?:${basePattern})\\b` : basePattern;
  const flags = options.caseSensitive ? 'g' : 'gi';
  let compiled: RegExp;
  try {
    compiled = new RegExp(pattern, flags);
  } catch {
    return {
      matches: [],
      matchingLineIndices: [],
      error: 'Invalid regular expression',
    };
  }

  const lines = output.split('\n');
  const matches: TerminalSearchMatch[] = [];
  const lineSet = new Set<number>();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    compiled.lastIndex = 0;
    let found = compiled.exec(line);
    while (found) {
      const length = found[0].length;
      if (length > 0) {
        matches.push({
          lineIndex,
          start: found.index,
          end: found.index + length,
          line,
        });
        lineSet.add(lineIndex);
      } else {
        if (compiled.lastIndex >= line.length) break;
        compiled.lastIndex += 1;
      }
      found = compiled.exec(line);
    }
  }

  return {
    matches,
    matchingLineIndices: [...lineSet],
  };
}

export interface ActiveServiceConsole {
  readonly title: string;
  readonly containerId?: string;
  readonly running?: boolean;
  readonly target: TerminalTarget;
}

export function buildServiceConsoleRequest(
  service: Pick<ServerServiceRow, 'id' | 'name' | 'manager' | 'running'>,
  mode: 'logs' | 'terminal',
): ActiveServiceConsole {
  if (service.manager === 'docker') {
    if (mode === 'terminal') {
      return {
        title: `${service.name} · Terminal`,
        containerId: service.id,
        running: service.running,
        target: { kind: 'docker-exec', containerId: service.id },
      };
    }
    return {
      title: `${service.name} · Logs`,
      containerId: service.id,
      running: service.running,
      target: { kind: 'docker-logs', containerId: service.id, tail: 500 },
    };
  }
  return {
    title: `${service.name} · Logs`,
    target: {
      kind: 'service-logs',
      manager: service.manager === 'pm2' ? 'pm2' : 'systemd',
      serviceId: service.id,
      tail: 400,
    },
  };
}

export function switchServiceConsoleMode(
  current: ActiveServiceConsole,
  mode: 'logs' | 'terminal',
): ActiveServiceConsole {
  if (!current.containerId) return current;
  const suffix = mode === 'logs' ? ' · Logs' : ' · Terminal';
  const title = / · (?:Logs|Terminal)$/.test(current.title)
    ? current.title.replace(/ · (?:Logs|Terminal)$/, suffix)
    : `${current.title}${suffix}`;
  return {
    ...current,
    title,
    target:
      mode === 'logs'
        ? { kind: 'docker-logs', containerId: current.containerId, tail: 500 }
        : { kind: 'docker-exec', containerId: current.containerId },
  };
}

export function buildDemoServiceConsoleOutput(
  serverName: string,
  consoleState: ActiveServiceConsole,
): string {
  if (consoleState.target.kind === 'docker-logs') {
    return `[demo] ${serverName} · container ${consoleState.target.containerId} logs\n[info] Worker started (pid 42)\n[info] Health check passed in 12ms\n`;
  }
  if (consoleState.target.kind === 'docker-exec') {
    return `Connected to container ${consoleState.target.containerId} on ${serverName} (demo shell).\nType 'help' for built-in commands.\n\n`;
  }
  if (consoleState.target.kind === 'service-logs') {
    return `[demo] ${serverName} · ${consoleState.target.manager} unit ${consoleState.target.serviceId}\n[info] Service active and healthy\n`;
  }
  return `[demo] ${consoleState.title}\n`;
}

export interface ServerSshProfileInput {
  readonly serverId: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly environment: 'native' | 'wsl';
  readonly auth: 'password' | 'agent';
  readonly password?: string;
  readonly rememberPassword?: boolean;
}
