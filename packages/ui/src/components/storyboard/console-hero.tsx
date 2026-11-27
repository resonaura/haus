/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import {
  colorToken,
  corners,
  insets,
  pct,
  px,
  rgba,
  type SemanticColorToken,
} from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { useHausUi } from '../../primitives/context.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import {
  Box,
  Grid,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { resolveColorToCss } from '../../renderers/contract.js';

export const HAUS_ASCII_LOGO_LINES: ReadonlyArray<{
  readonly art: string;
  readonly color: readonly [number, number, number];
}> = [
  { art: '          /\\          ', color: [158, 206, 106] },
  { art: '         /  \\         ', color: [158, 206, 106] },
  { art: '        / /\\ \\        ', color: [224, 175, 104] },
  { art: '       / /  \\ \\       ', color: [224, 175, 104] },
  { art: '      /_/____\\_\\      ', color: [255, 158, 100] },
  { art: '      |  _  _  |      ', color: [247, 118, 142] },
  { art: '      | | || | |      ', color: [247, 118, 142] },
  { art: '      | |_||_| |      ', color: [187, 154, 247] },
  { art: '      |  ____  |      ', color: [122, 162, 247] },
  { art: '      |_|    |_|      ', color: [125, 207, 255] },
  { art: '   H · A · U · S      ', color: [192, 202, 245] },
];

export const ANSI_TERMINAL_SWATCHES: ReadonlyArray<
  ReadonlyArray<{ readonly name: string; readonly hex: string; readonly rgb: readonly [number, number, number] }>
> = [
  [
    { name: 'ansi-0 black', hex: '#1c1e26', rgb: [28, 30, 38] },
    { name: 'ansi-1 red', hex: '#e95678', rgb: [233, 86, 120] },
    { name: 'ansi-2 green', hex: '#9ece6a', rgb: [158, 206, 106] },
    { name: 'ansi-3 yellow', hex: '#e0af68', rgb: [224, 175, 104] },
    { name: 'ansi-4 blue', hex: '#7aa2f7', rgb: [122, 162, 247] },
    { name: 'ansi-5 magenta', hex: '#bb9af7', rgb: [187, 154, 247] },
    { name: 'ansi-6 cyan', hex: '#7dcfff', rgb: [125, 207, 255] },
    { name: 'ansi-7 white', hex: '#c0caf5', rgb: [192, 202, 245] },
  ],
  [
    { name: 'ansi-8 br-black', hex: '#414868', rgb: [65, 72, 104] },
    { name: 'ansi-9 br-red', hex: '#f7768e', rgb: [247, 118, 142] },
    { name: 'ansi-10 br-green', hex: '#b9f27c', rgb: [185, 242, 124] },
    { name: 'ansi-11 br-yellow', hex: '#ff9e64', rgb: [255, 158, 100] },
    { name: 'ansi-12 br-blue', hex: '#89ddff', rgb: [137, 221, 255] },
    { name: 'ansi-13 br-magenta', hex: '#c099ff', rgb: [192, 153, 255] },
    { name: 'ansi-14 br-cyan', hex: '#73daca', rgb: [115, 218, 202] },
    { name: 'ansi-15 br-white', hex: '#ffffff', rgb: [255, 255, 255] },
  ],
];

const SEMANTIC_TOKENS: ReadonlyArray<{
  readonly token: SemanticColorToken;
  readonly label: string;
}> = [
  { token: 'canvas', label: 'canvas' },
  { token: 'surface', label: 'surface' },
  { token: 'surfaceSecondary', label: 'surfaceSecondary' },
  { token: 'card', label: 'card' },
  { token: 'soft', label: 'soft' },
  { token: 'border', label: 'border' },
  { token: 'textPrimary', label: 'textPrimary' },
  { token: 'textSecondary', label: 'textSecondary' },
  { token: 'textMuted', label: 'textMuted' },
  { token: 'accent', label: 'accent' },
  { token: 'accentForeground', label: 'accentFg' },
  { token: 'info', label: 'info' },
  { token: 'success', label: 'success' },
  { token: 'warning', label: 'warning' },
  { token: 'critical', label: 'critical' },
  { token: 'materialRim', label: 'materialRim' },
];

export function StoryboardConsoleHero({
  rendererName,
  onTogglePreviewMode,
}: {
  readonly rendererName?: string;
  readonly onTogglePreviewMode?: () => void;
}) {
  const { theme, viewport } = useHausUi();
  const [command, setCommand] = useState('');
  const [selectedAnsi, setSelectedAnsi] = useState<string | null>(null);
  const [logs, setLogs] = useState<readonly string[]>([
    'Type "help" for console commands (palette, tokens, theme, clear).',
  ]);

  const infoRows: ReadonlyArray<{ readonly key: string; readonly value: string }> = [
    { key: 'Host', value: rendererName ?? 'Haus Desktop UI' },
    { key: 'Theme', value: `Haus (${theme.mode})` },
    { key: 'Accent', value: 'Monochrome Pill + Contrasting Capsule' },
    { key: 'Surfaces', value: 'Superellipse · GlassRim · Motion Wash' },
    { key: 'Radii', value: `card ${theme.palette.radii.card}px · control ${theme.palette.radii.control}px · pill 999px` },
    { key: 'Viewport', value: `${Math.round(viewport.width)}×${Math.round(viewport.height)}` },
    { key: 'Shortcut', value: '⌘⇧U / Ctrl+Shift+U · Option+` · Esc' },
  ];

  const runCommand = (rawInput?: string) => {
    const cmd = (rawInput ?? command).trim();
    if (!cmd) return;
    if (rawInput === undefined) setCommand('');
    const lower = cmd.toLowerCase();
    if (lower === 'clear') {
      setLogs([]);
      return;
    }
    let reply = `zsh: unknown command "${cmd}" — try help, palette, tokens, theme, clear`;
    if (lower === 'help') {
      reply = 'Available: hausfetch · palette · tokens · theme · clear · echo <text>';
    } else if (lower === 'palette') {
      reply = ANSI_TERMINAL_SWATCHES.flat()
        .map((c) => `${c.name}=${c.hex}`)
        .join('  ');
    } else if (lower === 'tokens') {
      reply = SEMANTIC_TOKENS.map(
        (t) => `${t.label}=${resolveColorToCss(colorToken(t.token), theme, false)}`,
      ).join(' · ');
    } else if (lower === 'theme') {
      onTogglePreviewMode?.();
      reply = `Switched Storyboard preview appearance (was ${theme.mode}).`;
    } else if (lower === 'hausfetch') {
      reply = `haus@ui-storyboard — ${theme.mode} mode · ${Math.round(viewport.width)}×${Math.round(viewport.height)}`;
    } else if (lower.startsWith('echo ')) {
      reply = cmd.slice(5);
    }
    setLogs((prev) => [...prev.slice(-5), `➜ haus ✗ ${cmd}`, reply]);
  };

  return (
    <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
      <Box
        id="storyboard-console-card"
        dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
        style={{
          layout: { width: pct(100), position: 'relative', overflow: 'hidden' },
          material: new SolidMaterial(rgba(11, 13, 18, 0.98)),
          border: { width: 1, color: rgba(255, 255, 255, 0.12) },
          corners: corners(22),
          shadows: [{ offsetX: 0, offsetY: 16, blurRadius: 40, color: rgba(0, 0, 0, 0.4) }],
        }}
      >
        <Row
          align="center"
          justify="between"
          style={{
            layout: { width: pct(100), padding: insets(10, 16) },
            material: new SolidMaterial(rgba(255, 255, 255, 0.04)),
            border: { width: 1, color: rgba(255, 255, 255, 0.06) },
          }}
        >
          <Row align="center" gapPx={7}>
            <Box
              style={{
                layout: { width: px(11), height: px(11) },
                corners: corners(999, 'round'),
                material: new SolidMaterial(rgba(255, 95, 86, 1)),
              }}
            />
            <Box
              style={{
                layout: { width: px(11), height: px(11) },
                corners: corners(999, 'round'),
                material: new SolidMaterial(rgba(255, 189, 46, 1)),
              }}
            />
            <Box
              style={{
                layout: { width: px(11), height: px(11) },
                corners: corners(999, 'round'),
                material: new SolidMaterial(rgba(39, 201, 63, 1)),
              }}
            />
          </Row>
          <Text
            size={11.5}
            mono
            style={{ typography: { color: rgba(192, 202, 245, 0.72) } }}
          >
            haus — zsh — storyboard console
          </Text>
          <Text
            size={11}
            mono
            style={{ typography: { color: rgba(158, 206, 106, 0.9) } }}
          >
            {selectedAnsi ?? '16 ANSI + 16 semantic'}
          </Text>
        </Row>

        <Stack gapPx={14} style={{ layout: { width: pct(100), padding: insets(18, 20) } }}>
          <Row align="center" gapPx={6} wrap>
            <Text size={12.5} mono style={{ typography: { color: rgba(158, 206, 106, 1) } }}>
              ➜
            </Text>
            <Text size={12.5} mono style={{ typography: { color: rgba(125, 207, 255, 1), weight: 600 } }}>
              haus
            </Text>
            <Text size={12.5} mono style={{ typography: { color: rgba(122, 162, 247, 1) } }}>
              git:(
            </Text>
            <Text size={12.5} mono style={{ typography: { color: rgba(247, 118, 142, 1) } }}>
              platform
            </Text>
            <Text size={12.5} mono style={{ typography: { color: rgba(122, 162, 247, 1) } }}>
              )
            </Text>
            <Text size={12.5} mono style={{ typography: { color: rgba(224, 175, 104, 1) } }}>
              ✗
            </Text>
            <Text size={12.5} mono style={{ typography: { color: rgba(255, 255, 255, 0.94) } }}>
              hausfetch
            </Text>
          </Row>

          <Row align="start" gapPx={28} wrap style={{ layout: { width: pct(100) } }}>
            <Stack
              id="storyboard-ascii-logo"
              gapPx={1}
              style={{ layout: { flexShrink: 0, padding: insets(2, 4) } }}
            >
              {HAUS_ASCII_LOGO_LINES.map((line, index) => (
                <Text
                  key={index}
                  size={12.5}
                  mono
                  style={{
                    typography: {
                      color: rgba(line.color[0], line.color[1], line.color[2], 1),
                      lineHeight: 1.22,
                      whiteSpace: 'pre-wrap',
                      weight: 600,
                    },
                  }}
                >
                  {line.art}
                </Text>
              ))}
            </Stack>

            <Stack gapPx={5} style={{ layout: { flexGrow: 1, minWidth: px(260) } }}>
              <Text
                size={13}
                mono
                style={{ typography: { color: rgba(158, 206, 106, 1), weight: 700 } }}
              >
                haus@design-system.local
              </Text>
              <Text
                size={12}
                mono
                style={{ typography: { color: rgba(255, 255, 255, 0.32) } }}
              >
                ──────────────────────────────
              </Text>
              {infoRows.map((row) => (
                <Row key={row.key} gapPx={6} wrap>
                  <Text
                    size={12.5}
                    mono
                    style={{ typography: { color: rgba(224, 175, 104, 1), weight: 600 } }}
                  >
                    {`${row.key}:`}
                  </Text>
                  <Text
                    size={12.5}
                    mono
                    style={{ typography: { color: rgba(235, 238, 248, 0.94) } }}
                  >
                    {row.value}
                  </Text>
                </Row>
              ))}

              <Stack
                id="storyboard-ansi-palette"
                gapPx={0}
                style={{
                  layout: { margin: insets(8, 0, 0, 0), alignSelf: 'start', overflow: 'hidden' },
                  corners: corners(6),
                  border: { width: 1, color: rgba(255, 255, 255, 0.14) },
                }}
              >
                {ANSI_TERMINAL_SWATCHES.map((row, rIdx) => (
                  <Row key={rIdx} gapPx={0}>
                    {row.map((cell) => (
                      <Pressable
                        key={cell.name}
                        id={`storyboard-${cell.name.split(' ')[0]}`}
                        ariaLabel={`${cell.name} ${cell.hex}`}
                        onActivate={() => setSelectedAnsi(`${cell.name} · ${cell.hex}`)}
                        onPointerEnter={() => setSelectedAnsi(`${cell.name} · ${cell.hex}`)}
                        style={{
                          layout: { width: px(30), height: px(20), flexShrink: 0 },
                          material: new SolidMaterial(
                            rgba(cell.rgb[0], cell.rgb[1], cell.rgb[2], 1),
                          ),
                          border: { width: 0, style: 'none', color: rgba(0, 0, 0, 0) },
                        }}
                      />
                    ))}
                  </Row>
                ))}
              </Stack>
            </Stack>
          </Row>

          {logs.length > 0 && (
            <Stack
              gapPx={3}
              style={{
                layout: { width: pct(100), padding: insets(10, 12) },
                material: new SolidMaterial(rgba(255, 255, 255, 0.035)),
                border: { width: 1, color: rgba(255, 255, 255, 0.07) },
                corners: corners(10),
              }}
            >
              {logs.map((entry, idx) => (
                <Text
                  key={idx}
                  size={11.5}
                  mono
                  style={{
                    typography: {
                      color: entry.startsWith('➜')
                        ? rgba(125, 207, 255, 0.95)
                        : rgba(192, 202, 245, 0.8),
                    },
                  }}
                >
                  {entry}
                </Text>
              ))}
            </Stack>
          )}

          <Row align="center" gapPx={8} style={{ layout: { width: pct(100) } }}>
            <Row
              align="center"
              gapPx={8}
              style={{
                layout: { flexGrow: 1, minWidth: px(0), minHeight: px(36), padding: insets(0, 12) },
                material: new SolidMaterial(rgba(255, 255, 255, 0.05)),
                border: { width: 1, color: rgba(255, 255, 255, 0.1) },
                corners: corners(10),
              }}
            >
              <Text size={12} mono style={{ typography: { color: rgba(158, 206, 106, 1) } }}>
                ➜
              </Text>
              <Text size={12} mono style={{ typography: { color: rgba(125, 207, 255, 1) } }}>
                haus
              </Text>
              <Text size={12} mono style={{ typography: { color: rgba(224, 175, 104, 1) } }}>
                ✗
              </Text>
              <TextInput
                id="storyboard-console-input"
                ariaLabel="Storyboard console command"
                placeholder="Run command: help, palette, tokens, theme, clear…"
                value={command}
                onChange={setCommand}
                onSubmit={() => runCommand()}
                style={{
                  layout: { flexGrow: 1, minWidth: px(0), height: px(32) },
                  typography: { size: 12.5, fontFamily: 'mono', color: rgba(255, 255, 255, 0.95) },
                }}
              />
            </Row>
            <Pressable
              id="storyboard-console-run"
              onActivate={() => runCommand()}
              style={{
                layout: { height: px(36), padding: insets(0, 14), alignItems: 'center', justifyContent: 'center' },
                material: new SolidMaterial(rgba(255, 255, 255, 0.92)),
                corners: corners(10),
                cursor: 'pointer',
              }}
            >
              <Text size={12} weight={600} style={{ typography: { color: rgba(12, 14, 18, 1) } }}>
                Run
              </Text>
            </Pressable>
          </Row>
        </Stack>
        <GlassRim preset="card" radiusPx={21} opacity={0.55} />
      </Box>

      <Grid columns={4} gapPx={8}>
        {SEMANTIC_TOKENS.map((item) => {
          const css = resolveColorToCss(colorToken(item.token), theme, false);
          return (
            <Row
              key={item.token}
              align="center"
              gapPx={9}
              style={{
                layout: { padding: insets(8, 10), minWidth: px(0) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('borderSubtle') },
                corners: corners(12),
              }}
            >
              <Box
                style={{
                  layout: { width: px(22), height: px(22), flexShrink: 0 },
                  corners: corners(7),
                  material: new SolidMaterial(colorToken(item.token)),
                  border: { width: 1, color: colorToken('border') },
                }}
              />
              <Stack gapPx={1} style={{ layout: { minWidth: px(0), flexGrow: 1 } }}>
                <Text size={11.5} weight={600} style={{ typography: { maxLines: 1, truncate: true } }}>
                  {item.label}
                </Text>
                <Text size={10} tone="muted" mono style={{ typography: { maxLines: 1, truncate: true } }}>
                  {css}
                </Text>
              </Stack>
            </Row>
          );
        })}
      </Grid>
    </Stack>
  );
}
