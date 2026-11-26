/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { TerminalTarget } from '@haus/core/protocol';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const BRIGHT_GREEN = '\x1b[92m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const BRIGHT_BLUE = '\x1b[94m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[31m';

const DEMO_COMMANDS = ['help', 'uptime', 'docker ps', 'df -h', 'ls', 'colors', 'clear'] as const;

export function formatDemoAnsiLogs(rawText: string, label: string): string {
  const lines = rawText.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return `${DIM}[demo]${RESET} ${CYAN}${label}${RESET} waiting for log lines…\r\n`;
  }
  return (
    lines
      .map((line) => {
        const tsMatch =
          /^(\[[^\]]+\]|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s*(.*)$/.exec(line);
        const ts = tsMatch?.[1] ?? '';
        const body = tsMatch ? (tsMatch[2] ?? '') : line;
        const coloredBody = body
          .replace(/\b(ERROR|FAIL|CRITICAL)\b/g, `${BOLD}${RED}$1${RESET}`)
          .replace(/\b(WARN|WARNING)\b/g, `${YELLOW}$1${RESET}`)
          .replace(/\b(INFO|READY|OK|STARTED|CONNECTED)\b/g, `${GREEN}$1${RESET}`);
        return ts ? `${DIM}${ts}${RESET} ${coloredBody}` : coloredBody;
      })
      .join('\r\n') + '\r\n'
  );
}

function buildTrueColorBar(): string {
  const blocks: string[] = [];
  for (let i = 0; i < 36; i++) {
    const t = i / 35;
    const r = Math.round(127 + 127 * Math.sin(t * Math.PI * 2));
    const g = Math.round(127 + 127 * Math.sin(t * Math.PI * 2 + 2.094));
    const b = Math.round(127 + 127 * Math.sin(t * Math.PI * 2 + 4.188));
    blocks.push(`\x1b[48;2;${r};${g};${b}m `);
  }
  return `${blocks.join('')}${RESET}`;
}

function executeDemoCommand(
  serverName: string,
  command: string,
): {
  readonly clear?: boolean;
  readonly output: string;
} {
  const trimmed = command.trim();
  if (!trimmed) return { output: '' };
  if (trimmed === 'clear') return { clear: true, output: '' };

  if (trimmed === 'help') {
    return {
      output:
        [
          `${BOLD}${CYAN}Available demo commands:${RESET}`,
          `  ${GREEN}help${RESET}       Show this command summary`,
          `  ${GREEN}uptime${RESET}     Show server uptime and load averages`,
          `  ${GREEN}docker ps${RESET}  List running containers on ${serverName}`,
          `  ${GREEN}df -h${RESET}      Show mounted filesystems and disk usage`,
          `  ${GREEN}ls${RESET}         List workspace files with ANSI colors`,
          `  ${GREEN}colors${RESET}     Verify ANSI 16, 256-color, and 24-bit TrueColor`,
          `  ${GREEN}clear${RESET}      Clear terminal scrollback`,
        ].join('\r\n') + '\r\n',
    };
  }

  if (trimmed === 'uptime') {
    return {
      output: ` 09:42:18 up ${GREEN}14 days,  6:21${RESET},  1 user,  load average: ${CYAN}0.24, 0.31, 0.28${RESET}\r\n`,
    };
  }

  if (trimmed === 'docker ps') {
    return {
      output:
        [
          `${BOLD}CONTAINER ID   IMAGE                        STATUS                   NAMES${RESET}`,
          `${DIM}7a21c90e44b1${RESET}   ${CYAN}koenkk/zigbee2mqtt:latest${RESET}    ${BRIGHT_GREEN}Up 9 days (healthy)${RESET}      zigbee2mqtt`,
          `${DIM}3e81a44c2208${RESET}   ${CYAN}eclipse-mosquitto:2${RESET}          ${BRIGHT_GREEN}Up 14 days (healthy)${RESET}     mosquitto`,
          `${DIM}9f12b710ac30${RESET}   ${CYAN}ghcr.io/haus/nvr:latest${RESET}      ${BRIGHT_GREEN}Up 6 days (healthy)${RESET}      haus-nvr`,
        ].join('\r\n') + '\r\n',
    };
  }

  if (trimmed === 'df -h') {
    return {
      output:
        [
          `${BOLD}Filesystem      Size  Used Avail Use% Mounted on${RESET}`,
          `/dev/nvme0n1p2  468G  162G  282G  ${GREEN}37%${RESET} /`,
          `/dev/sda1       3.6T  1.4T  2.1T  ${YELLOW}41%${RESET} /mnt/recordings`,
          `tmpfs           7.8G   18M  7.8G  ${CYAN} 1%${RESET} /run`,
        ].join('\r\n') + '\r\n',
    };
  }

  if (trimmed === 'ls' || trimmed === 'ls -la') {
    return {
      output:
        [
          `${BOLD}${BRIGHT_BLUE}config/${RESET}   ${BOLD}${BRIGHT_BLUE}docker/${RESET}   ${BOLD}${BRIGHT_BLUE}recordings/${RESET}   ${GREEN}haus-hub*${RESET}   ${CYAN}compose.yaml${RESET}   ${DIM}README.md${RESET}`,
        ].join('\r\n') + '\r\n',
    };
  }

  if (trimmed === 'colors') {
    const ansi16 = Array.from({ length: 16 }, (_, i) =>
      i < 8 ? `\x1b[4${i}m  ${RESET}` : `\x1b[10${i - 8}m  ${RESET}`,
    ).join('');
    return {
      output:
        [
          `${BOLD}ANSI 16:${RESET}    ${ansi16}`,
          `${BOLD}TrueColor:${RESET}  ${buildTrueColorBar()}`,
          `${MAGENTA}\x1b[3mItalic${RESET} · ${BOLD}Bold${RESET} · \x1b[4mUnderline${RESET} · \x1b[9mStrike${RESET} · ${DIM}Dim${RESET}`,
        ].join('\r\n') + '\r\n',
    };
  }

  return {
    output: `${RED}bash:${RESET} ${trimmed}: command not found ${DIM}(try 'help')${RESET}\r\n`,
  };
}

/**
 * Interactive ANSI-colored local demo PTY supporting character echo, Backspace, Ctrl+C,
 * Ctrl+L, Up/Down history, Tab completion, and full xterm color output.
 */
export class DemoInteractivePty {
  private buffer = '';
  private readonly history: string[] = [];
  private historyIdx = -1;
  private readonly prompt: string;

  constructor(
    private readonly serverName: string,
    target: TerminalTarget,
    private readonly writeOut: (chunk: string) => void,
    private readonly clearOut: () => void,
  ) {
    const hostSlug = serverName.toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'haus-hub';
    const user = target.kind === 'docker-exec' ? 'root' : 'ops';
    const host = target.kind === 'docker-exec' ? target.containerId : hostSlug;
    this.prompt = `${BOLD}${GREEN}${user}@${host}${RESET}:${BOLD}${BLUE}~${RESET}${user === 'root' ? '#' : '$'} `;
  }

  banner(): void {
    this.writeOut(
      `${DIM}Connected to ${RESET}${BOLD}${this.serverName}${RESET}${DIM} via Haus xterm.js (demo PTY).${RESET}\r\n` +
        `${DIM}Type ${RESET}${CYAN}help${RESET}${DIM}, ${RESET}${CYAN}docker ps${RESET}${DIM}, ${RESET}${CYAN}uptime${RESET}${DIM}, or ${RESET}${CYAN}colors${RESET}${DIM}.${RESET}\r\n\r\n` +
        this.prompt,
    );
  }

  feed(data: string): void {
    for (let i = 0; i < data.length; i++) {
      // Escape sequences (Up / Down history)
      if (data[i] === '\x1b' && data[i + 1] === '[') {
        const code = data[i + 2];
        i += 2;
        if (code === 'A' && this.history.length > 0) {
          this.historyIdx = Math.max(
            0,
            this.historyIdx < 0 ? this.history.length - 1 : this.historyIdx - 1,
          );
          this.replaceLine(this.history[this.historyIdx] ?? '');
        } else if (code === 'B' && this.historyIdx >= 0) {
          this.historyIdx += 1;
          if (this.historyIdx >= this.history.length) {
            this.historyIdx = -1;
            this.replaceLine('');
          } else {
            this.replaceLine(this.history[this.historyIdx] ?? '');
          }
        }
        continue;
      }

      const ch = data[i] ?? '';
      if (ch === '\x03') {
        this.buffer = '';
        this.historyIdx = -1;
        this.writeOut(`^C\r\n${this.prompt}`);
      } else if (ch === '\x0c') {
        this.clearOut();
        this.writeOut(`${this.prompt}${this.buffer}`);
      } else if (ch === '\r' || ch === '\n') {
        const cmd = this.buffer;
        this.buffer = '';
        this.historyIdx = -1;
        if (cmd.trim()) this.history.push(cmd.trim());
        this.writeOut('\r\n');
        const res = executeDemoCommand(this.serverName, cmd);
        if (res.clear) {
          this.clearOut();
          this.writeOut(this.prompt);
        } else {
          this.writeOut(`${res.output}${this.prompt}`);
        }
      } else if (ch === '\x7f' || ch === '\b') {
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.slice(0, -1);
          this.writeOut('\b \b');
        }
      } else if (ch === '\t') {
        const match = DEMO_COMMANDS.find((c) => c.startsWith(this.buffer) && c !== this.buffer);
        if (match) {
          const rest = match.slice(this.buffer.length);
          this.buffer = match;
          this.writeOut(rest);
        }
      } else if (ch >= ' ') {
        this.buffer += ch;
        this.writeOut(ch);
      }
    }
  }

  private replaceLine(next: string): void {
    if (this.buffer.length > 0) {
      this.writeOut('\b \b'.repeat(this.buffer.length));
    }
    this.buffer = next;
    if (next) this.writeOut(next);
  }
}
