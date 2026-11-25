/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import type { HaImportSummary } from '@haus/core/transport';
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

export interface HaDataImportModalProps {
  readonly fileName?: string;
  readonly entries: readonly HaImportSummary[];
  readonly busy?: boolean;
  readonly importing: boolean;
  readonly importStarted: boolean;
  readonly complete: boolean;
  readonly completed: number;
  readonly error?: string;
  readonly formatDomain: (domain: string) => string;
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

export function HaDataImportModal({
  fileName,
  entries,
  busy = false,
  importing,
  importStarted,
  complete,
  completed,
  error,
  formatDomain,
  filePickerSlot,
  onPickFile,
  onLoadSample,
  allowJsonPaste = false,
  rawJson = '',
  onRawJsonChange,
  onParseJson,
  onImport,
  onClose,
}: HaDataImportModalProps) {
  const canClose = !busy && !importing;
  const percent = entries.length ? Math.round((completed / entries.length) * 100) : 0;

  return (
    <HausDialog
      title="Import Home Assistant data"
      size="md"
      backdrop="blur"
      scrollable
      onClose={() => {
        if (canClose) onClose();
      }}
      footer={
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton
            id="ha-data-import-close"
            variant="ghost"
            size="sm"
            disabled={!canClose}
            onPress={onClose}
          >
            {complete ? 'Close' : 'Cancel'}
          </HausButton>
          {!complete && (
            <HausButton
              id="ha-data-import-submit"
              variant="primary"
              size="sm"
              disabled={busy || importing || entries.length === 0}
              onPress={onImport}
            >
              <Text
                size={12.5}
                style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
              >
                {importing ? 'Importing…' : 'Stage entries'}
              </Text>
            </HausButton>
          )}
        </Row>
      }
    >
      <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
        <Text size={12.5} tone="secondary" className="flow-description">
          Selected Home Assistant entries can be staged from an export. Imported entries stay
          disabled until ownership is switched to Haus.
        </Text>

        {filePickerSlot}

        {(onPickFile || onLoadSample) && (
          <Row align="center" gapPx={8} wrap>
            {onPickFile && (
              <HausButton
                id="ha-data-import-choose-file"
                variant="secondary"
                size="sm"
                disabled={busy || importing}
                onPress={onPickFile}
              >
                <UiIcon name="file-up" size={14} />
                <Text size={12.5}>Choose JSON file</Text>
              </HausButton>
            )}
            {onLoadSample && (
              <HausButton
                id="ha-data-import-load-sample"
                variant="ghost"
                size="sm"
                disabled={busy || importing}
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
              id="ha-data-import-json-input"
              label="Or paste Home Assistant transfer JSON"
              ariaLabel="Home Assistant transfer JSON"
              placeholder='{"entries":[{"entry":{"entryId":"e1","domain":"hue","title":"Bridge","data":{},"disabledBy":"user"}}]}'
              rows={5}
              value={rawJson}
              disabled={busy || importing}
              onChange={(value) => onRawJsonChange?.(value)}
              style={{ layout: { width: pct(100) } }}
            />
            {onParseJson && (
              <Row justify="start">
                <HausButton
                  id="ha-data-import-parse-json"
                  variant="secondary"
                  size="sm"
                  disabled={busy || importing || !rawJson.trim()}
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
              {`${entries.length} entries ready`}
            </Text>
            <ScrollView
              orientation="vertical"
              style={{ layout: { width: pct(100), maxHeight: px(220) } }}
            >
              <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
                {entries.map((item) => (
                  <Row
                    key={item.id}
                    id={`ha-data-import-entry-${item.id}`}
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
                    <Text size={12.5} weight={600}>
                      {`${formatDomain(item.domain)} · ${item.title}`}
                    </Text>
                    <Text size={11.5} tone="muted">
                      {`${item.devices} devices · ${item.entities} entities`}
                    </Text>
                  </Row>
                ))}
              </Stack>
            </ScrollView>
          </Stack>
        )}

        {(importing || complete || importStarted) && (
          <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
            <Row align="center" justify="between" style={{ layout: { width: pct(100) } }}>
              <Text size={12} tone="secondary">
                {complete
                  ? 'Staged'
                  : importing
                    ? `Staging ${completed} of ${entries.length}`
                    : `Stopped after ${completed} of ${entries.length}`}
              </Text>
              <Text size={12} mono tone="muted">
                {`${percent}%`}
              </Text>
            </Row>
            <Box
              role="progressbar"
              ariaLabel="Home Assistant import progress"
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
            id="ha-data-import-error"
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
