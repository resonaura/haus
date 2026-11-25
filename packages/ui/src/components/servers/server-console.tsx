/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useMemo, useState } from 'react';
import { searchTerminalOutput, type TerminalSearchOptions } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  Pressable,
  Row,
  ScrollView,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import { TerminalSearchBar } from './terminal-search.js';

export type ConsoleConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface PendingHostKeyPrompt {
  readonly fingerprint: string;
  readonly changed: boolean;
}

function statusDotColor(state: ConsoleConnectionState) {
  if (state === 'connected') return rgba(52, 211, 153, 1);
  if (state === 'connecting') return rgba(251, 191, 36, 1);
  if (state === 'disconnected') return colorToken('critical');
  return colorToken('textMuted');
}

export function ServerConsoleView({
  title,
  readOnly,
  state,
  output,
  paused,
  statusMessage,
  pendingHostKey,
  onTogglePause,
  onClear,
  onReconnect,
  onCopyOutput,
  onSwitchToLogs,
  onSendCommand,
  onSendInterrupt,
  onTrustHostKey,
  onDismissHostKey,
}: {
  readonly title: string;
  readonly readOnly: boolean;
  readonly state: ConsoleConnectionState;
  readonly output: string;
  readonly paused: boolean;
  readonly statusMessage?: string;
  readonly pendingHostKey?: PendingHostKeyPrompt;
  readonly onTogglePause: () => void;
  readonly onClear: () => void;
  readonly onReconnect: () => void;
  readonly onCopyOutput?: (text: string) => void;
  readonly onSwitchToLogs?: () => void;
  readonly onSendCommand?: (command: string) => void;
  readonly onSendInterrupt?: () => void;
  readonly onTrustHostKey?: (fingerprint: string) => void;
  readonly onDismissHostKey?: () => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
  const [command, setCommand] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOptions, setSearchOptions] = useState<TerminalSearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [matchIndex, setMatchIndex] = useState(0);
  const [filterMatchesOnly, setFilterMatchesOnly] = useState(false);
  const [copied, setCopied] = useState(false);

  const searchResult = useMemo(
    () =>
      searchOpen
        ? searchTerminalOutput(output, query, searchOptions)
        : { matches: [], matchingLineIndices: [] },
    [output, query, searchOpen, searchOptions],
  );

  useEffect(() => {
    setMatchIndex(0);
  }, [query, searchOptions, searchOpen]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const activeMatchCount = searchResult.matches.length;
  const clampedMatchIndex = activeMatchCount > 0 ? matchIndex % activeMatchCount : -1;
  const activeLineIndex =
    clampedMatchIndex >= 0 ? searchResult.matches[clampedMatchIndex]?.lineIndex : undefined;

  const navigateMatch = (backward = false) => {
    if (activeMatchCount <= 0) return;
    setMatchIndex((prev) =>
      backward ? (prev - 1 + activeMatchCount) % activeMatchCount : (prev + 1) % activeMatchCount,
    );
  };

  const renderedOutput = useMemo(() => {
    if (!output) return '';
    if (!searchOpen || !query || searchResult.matches.length === 0) return output;
    const lines = output.split('\n');
    const matchedSet = new Set(searchResult.matchingLineIndices);
    if (filterMatchesOnly) {
      return searchResult.matchingLineIndices
        .map((idx) => `${idx === activeLineIndex ? '▶ ' : '  '}[${idx + 1}] ${lines[idx] ?? ''}`)
        .join('\n');
    }
    return lines
      .map((line, idx) =>
        idx === activeLineIndex ? `▶ ${line}` : matchedSet.has(idx) ? `• ${line}` : line,
      )
      .join('\n');
  }, [activeLineIndex, filterMatchesOnly, output, query, searchOpen, searchResult]);

  const submitCommand = () => {
    const next = command.trim();
    if (!next || !onSendCommand) return;
    onSendCommand(next);
    setCommand('');
  };

  return (
    <Stack
      gapPx={10}
      style={{
        layout: { width: pct(100), padding: insets(14) },
        material: new SolidMaterial(colorToken('surfaceSecondary')),
        border: { width: 1, color: colorToken('border') },
        corners: corners(16),
      }}
    >
      <Row align="center" justify="between" gapPx={10} wrap style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={8}>
          <Box
            style={{
              layout: { width: px(8), height: px(8), flexShrink: 0 },
              material: new SolidMaterial(statusDotColor(state)),
              corners: corners(4),
            }}
          />
          <UiIcon name={readOnly ? 'file-text' : 'terminal'} size={15} />
          <Text size={13} weight={600}>
            {title}
          </Text>
          <Text size={11.5} tone="muted">
            {statusMessage || state}
          </Text>
        </Row>
        <Row align="center" gapPx={6} wrap>
          <HausButton id="console-pause-toggle" variant="ghost" size="sm" onPress={onTogglePause}>
            <UiIcon name={paused ? 'play' : 'pause'} size={13} />
            <Text size={12}>{paused ? 'Resume' : 'Pause'}</Text>
          </HausButton>
          {!readOnly && onSendInterrupt && (
            <HausButton id="console-ctrl-c" variant="ghost" size="sm" onPress={onSendInterrupt}>
              <Text size={12}>Ctrl+C</Text>
            </HausButton>
          )}
          {!readOnly && onSwitchToLogs && (
            <HausButton
              id="console-switch-to-logs"
              variant="ghost"
              size="sm"
              onPress={onSwitchToLogs}
            >
              <UiIcon name="file-text" size={13} />
              <Text size={12}>View logs</Text>
            </HausButton>
          )}
          <HausButton
            id="console-search-toggle"
            variant={searchOpen ? 'secondary' : 'ghost'}
            size="sm"
            onPress={() => setSearchOpen((prev) => !prev)}
          >
            <UiIcon name="search" size={13} />
            <Text size={12}>Find</Text>
          </HausButton>
          {onCopyOutput && (
            <HausButton
              id="console-copy"
              variant="ghost"
              size="sm"
              disabled={!output}
              onPress={() => {
                onCopyOutput(output);
                setCopied(true);
              }}
            >
              <UiIcon name={copied ? 'check' : 'copy'} size={13} />
              <Text size={12}>{copied ? 'Copied' : 'Copy'}</Text>
            </HausButton>
          )}
          <HausButton id="console-clear" variant="ghost" size="sm" onPress={onClear}>
            <UiIcon name="trash-2" size={13} />
            <Text size={12}>Clear</Text>
          </HausButton>
          <HausButton id="console-reconnect" variant="outline" size="sm" onPress={onReconnect}>
            <UiIcon name="rotate-cw" size={13} />
            <Text size={12}>Reconnect</Text>
          </HausButton>
        </Row>
      </Row>

      {searchOpen && (
        <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
          <TerminalSearchBar
            open={searchOpen}
            query={query}
            onQueryChange={setQuery}
            options={searchOptions}
            onOptionsChange={setSearchOptions}
            result={{ resultIndex: clampedMatchIndex, resultCount: activeMatchCount }}
            error={searchResult.error}
            onFind={navigateMatch}
            onClose={() => {
              setSearchOpen(false);
              setFilterMatchesOnly(false);
            }}
          />
          {searchResult.matchingLineIndices.length > 0 && (
            <Row align="center" justify="between" gapPx={8}>
              <Text size={11} tone="muted">
                {`${searchResult.matchingLineIndices.length} matching lines`}
              </Text>
              <HausButton
                id="console-search-filter-toggle"
                variant="ghost"
                size="sm"
                onPress={() => setFilterMatchesOnly((prev) => !prev)}
              >
                <Text size={11}>
                  {filterMatchesOnly ? 'Show full output' : 'Show matching lines'}
                </Text>
              </HausButton>
            </Row>
          )}
        </Stack>
      )}

      {pendingHostKey && (
        <Row
          align="center"
          justify="between"
          gapPx={12}
          wrap
          style={{
            layout: { width: pct(100), padding: insets(12, 14) },
            material: new SolidMaterial(rgba(251, 191, 36, 0.12)),
            border: { width: 1, color: rgba(251, 191, 36, 0.35) },
            corners: corners(12),
          }}
        >
          <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(200) } }}>
            <Text size={12.5} weight={600}>
              {pendingHostKey.changed
                ? 'Host identity key changed — verify before trusting'
                : 'Verify server Ed25519 fingerprint'}
            </Text>
            <Text size={11} tone="muted" mono>
              {pendingHostKey.fingerprint}
            </Text>
          </Stack>
          <Row align="center" gapPx={8}>
            {onDismissHostKey && (
              <HausButton
                id="console-dismiss-host-key"
                variant="ghost"
                size="sm"
                onPress={onDismissHostKey}
              >
                Cancel
              </HausButton>
            )}
            {onTrustHostKey && (
              <HausButton
                id="console-trust-host-key"
                variant="primary"
                size="sm"
                onPress={() => onTrustHostKey(pendingHostKey.fingerprint)}
              >
                <UiIcon name="shield-check" size={13} color={primaryFg} />
                <Text
                  size={12}
                  style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
                >
                  Trust & connect
                </Text>
              </HausButton>
            )}
          </Row>
        </Row>
      )}

      <ScrollView
        orientation="vertical"
        style={{
          layout: { width: pct(100), height: px(300), padding: insets(12) },
          material: new SolidMaterial(colorToken('surface')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(12),
        }}
      >
        <Text size={12} mono>
          {renderedOutput || (state === 'connecting' ? 'Connecting…' : 'Waiting for output…')}
        </Text>
      </ScrollView>

      {!readOnly && onSendCommand && (
        <Row align="center" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <Row
            align="center"
            gapPx={8}
            style={{
              layout: { flexGrow: 1, minWidth: px(0), minHeight: px(36), padding: insets(0, 12) },
              material: new SolidMaterial(colorToken('surface')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(10),
            }}
          >
            <Text size={12} tone="muted" mono>
              $
            </Text>
            <TextInput
              id="server-terminal-input"
              ariaLabel="Terminal command"
              placeholder="Run command (e.g. help, uptime, docker ps, df -h)"
              value={command}
              onChange={setCommand}
              style={{
                layout: { flexGrow: 1, minWidth: px(0), height: px(32) },
                typography: { size: 12.5, color: colorToken('textPrimary') },
              }}
            />
          </Row>
          <Pressable
            id="server-terminal-send"
            onActivate={submitCommand}
            style={{
              layout: {
                direction: 'row',
                alignItems: 'center',
                gap: px(6),
                height: px(36),
                padding: insets(0, 14),
              },
              material: new SolidMaterial(colorToken('accent')),
              corners: corners(10),
            }}
          >
            <Text
              size={12.5}
              style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
            >
              Send
            </Text>
          </Pressable>
        </Row>
      )}
    </Stack>
  );
}
