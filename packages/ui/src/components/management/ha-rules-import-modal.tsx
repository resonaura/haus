/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import type { RuleImportEntry, RuleImportStatus } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausDialog,
  HausTextArea,
  Row,
  ScrollView,
  Stack,
  Text,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

export interface HaRulesImportModalProps {
  readonly fileName?: string;
  readonly entries: readonly RuleImportEntry[];
  readonly importing: boolean;
  readonly complete: boolean;
  readonly completed: number;
  readonly saved: number;
  readonly error?: string;
  readonly filePickerSlot?: ReactNode;
  readonly onPickFile?: () => void;
  readonly onLoadSample?: () => void;
  readonly allowJsonPaste?: boolean;
  readonly rawJson?: string;
  readonly onRawJsonChange?: (value: string) => void;
  readonly onParseJson?: () => void;
  readonly onImport: () => void;
  readonly onClose: () => void;
}

function statusLabel(status: RuleImportStatus): string {
  if (status === 'saved') return 'Saved';
  if (status === 'skipped') return 'Skipped';
  if (status === 'failed') return 'Failed';
  return 'Ready';
}

function statusTone(status: RuleImportStatus): 'accent' | 'critical' | 'muted' {
  if (status === 'saved') return 'accent';
  if (status === 'failed') return 'critical';
  return 'muted';
}

export function HaRulesImportModal({
  fileName,
  entries,
  importing,
  complete,
  completed,
  saved,
  error,
  filePickerSlot,
  onPickFile,
  onLoadSample,
  allowJsonPaste = false,
  rawJson = '',
  onRawJsonChange,
  onParseJson,
  onImport,
  onClose,
}: HaRulesImportModalProps) {
  const canClose = !importing;
  const ready = entries.some((entry) => entry.status === 'ready');
  const percent = entries.length ? Math.round((completed / entries.length) * 100) : 0;

  return (
    <HausDialog
      title="Import Home Assistant rules"
      size="md"
      backdrop="blur"
      scrollable
      onClose={() => {
        if (canClose) onClose();
      }}
      footer={
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton
            id="ha-import-close"
            variant="ghost"
            size="sm"
            disabled={!canClose}
            onPress={onClose}
          >
            {complete ? 'Close' : 'Cancel'}
          </HausButton>
          {!complete && (
            <HausButton
              id="ha-import-submit"
              variant="primary"
              size="sm"
              disabled={importing || !ready}
              onPress={onImport}
            >
              <Text
                size={12.5}
                style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
              >
                {importing ? 'Saving…' : 'Import rules'}
              </Text>
            </HausButton>
          )}
        </Row>
      }
    >
      <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
        <Text size={12.5} tone="secondary" className="flow-description">
          Haus stores imported automations disabled. Home Assistant stays active until each rule is
          checked and explicitly cut over.
        </Text>

        {filePickerSlot}

        {(onPickFile || onLoadSample) && (
          <Row align="center" gapPx={8} wrap>
            {onPickFile && (
              <HausButton
                id="ha-import-choose-file"
                variant="secondary"
                size="sm"
                disabled={importing}
                onPress={onPickFile}
              >
                <UiIcon name="file-up" size={14} />
                <Text size={12.5}>Choose JSON file</Text>
              </HausButton>
            )}
            {onLoadSample && (
              <HausButton
                id="ha-import-load-sample"
                variant="ghost"
                size="sm"
                disabled={importing}
                onPress={onLoadSample}
              >
                <Text size={12.5}>Load sample bundle</Text>
              </HausButton>
            )}
          </Row>
        )}

        {allowJsonPaste && (
          <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
            <HausTextArea
              id="ha-import-json-input"
              label="Or paste rules transfer JSON"
              ariaLabel="Rules transfer JSON"
              placeholder='{"schemaVersion":1,"source":"home_assistant","automations":[],"scripts":[]}'
              rows={5}
              value={rawJson}
              disabled={importing}
              onChange={(value) => onRawJsonChange?.(value)}
              style={{ layout: { width: pct(100) } }}
            />
            {onParseJson && (
              <Row justify="start">
                <HausButton
                  id="ha-import-parse-json"
                  variant="secondary"
                  size="sm"
                  disabled={importing || !rawJson.trim()}
                  onPress={onParseJson}
                >
                  <Text size={12.5}>Parse JSON</Text>
                </HausButton>
              </Row>
            )}
          </Stack>
        )}

        {fileName && (
          <Text size={12} tone="muted" className="management-notice">
            {fileName}
          </Text>
        )}

        {entries.length > 0 && (
          <Stack gapPx={8} className="ha-import-summary" style={{ layout: { width: pct(100) } }}>
            <Text size={12.5} weight={600}>
              {`${entries.length} rules · ${saved} saved on Haus`}
            </Text>
            <ScrollView
              orientation="vertical"
              style={{ layout: { width: pct(100), maxHeight: px(220) } }}
            >
              <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
                {entries.map((entry) => (
                  <Row
                    key={entry.key}
                    id={`ha-import-entry-${entry.key}`}
                    align="center"
                    justify="between"
                    gapPx={10}
                    wrap
                    style={{
                      layout: { width: pct(100), padding: insets(8, 10) },
                      material: new SolidMaterial(colorToken('surfaceSecondary')),
                      border: { width: 1, color: colorToken('border') },
                      corners: corners(10),
                    }}
                  >
                    <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(150) } }}>
                      <Text size={12.5} weight={600}>
                        {`${entry.name} · ${entry.kind}`}
                      </Text>
                      {entry.reason && (
                        <Text size={11.5} tone="muted">
                          {entry.reason}
                        </Text>
                      )}
                    </Stack>
                    <Text size={11.5} weight={600} tone={statusTone(entry.status)}>
                      {statusLabel(entry.status)}
                    </Text>
                  </Row>
                ))}
              </Stack>
            </ScrollView>
          </Stack>
        )}

        {(importing || complete || completed > 0) && (
          <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
            <Row align="center" justify="between" style={{ layout: { width: pct(100) } }}>
              <Text size={12} tone="secondary">
                {complete ? 'Import finished' : `Saving ${completed} of ${entries.length}`}
              </Text>
              <Text size={12} mono tone="muted">
                {`${percent}%`}
              </Text>
            </Row>
            <Box
              role="progressbar"
              ariaLabel="Home Assistant rule import progress"
              style={{
                layout: { width: pct(100), height: px(6), overflow: 'hidden' },
                material: new SolidMaterial(colorToken('border')),
                corners: corners(999),
              }}
            >
              <Box
                style={{
                  layout: { width: pct(percent), height: pct(100) },
                  material: new SolidMaterial(colorToken('accent')),
                  corners: corners(999),
                  pointerEvents: 'none',
                }}
              />
            </Box>
          </Stack>
        )}

        {error && (
          <Text
            id="ha-import-error"
            semantic="p"
            role="alert"
            tone="critical"
            size={12.5}
            className="form-error"
          >
            {error}
          </Text>
        )}
      </Stack>
    </HausDialog>
  );
}
