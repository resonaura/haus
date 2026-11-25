/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import type { SceneImportSummary } from '@haus/core/transport';
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

export interface HaScenesImportModalProps {
  readonly fileName?: string;
  readonly entries: readonly SceneImportSummary[];
  readonly importing: boolean;
  readonly complete: boolean;
  readonly completed: number;
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

function sceneStatusText(scene: SceneImportSummary, complete: boolean): string {
  if (scene.restoreRoom) return 'Restore room';
  if (scene.exists) return 'Already in Haus, will skip';
  return complete ? 'Saved' : 'Ready';
}

function sceneStatusTone(scene: SceneImportSummary, complete: boolean): 'accent' | 'muted' {
  if (scene.restoreRoom) return 'accent';
  if (scene.exists) return 'muted';
  return complete ? 'accent' : 'muted';
}

export function HaScenesImportModal({
  fileName,
  entries,
  importing,
  complete,
  completed,
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
}: HaScenesImportModalProps) {
  const canClose = !importing;
  const percent = entries.length ? Math.round((completed / entries.length) * 100) : 0;

  return (
    <HausDialog
      title="Import Home Assistant scenes"
      size="md"
      backdrop="blur"
      scrollable
      onClose={() => {
        if (canClose) onClose();
      }}
      footer={
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton
            id="ha-scenes-import-close"
            variant="ghost"
            size="sm"
            disabled={!canClose}
            onPress={onClose}
          >
            {complete ? 'Close' : 'Cancel'}
          </HausButton>
          {!complete && (
            <HausButton
              id="ha-scenes-import-submit"
              variant="primary"
              size="sm"
              disabled={importing || entries.length === 0}
              onPress={onImport}
            >
              <Text
                size={12.5}
                style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
              >
                {importing ? 'Saving…' : 'Save scenes'}
              </Text>
            </HausButton>
          )}
        </Row>
      }
    >
      <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
        <Text size={12.5} tone="secondary" className="flow-description">
          Scenes are saved on Haus without running them. Existing Haus scenes are skipped to
          preserve your edits.
        </Text>

        {filePickerSlot}

        {(onPickFile || onLoadSample) && (
          <Row align="center" gapPx={8} wrap>
            {onPickFile && (
              <HausButton
                id="ha-scenes-import-choose-file"
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
                id="ha-scenes-import-load-sample"
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
              id="ha-scenes-import-json-input"
              label="Or paste scene transfer JSON"
              ariaLabel="Scene transfer JSON"
              placeholder='{"scenes":[{"id":"evening","name":"Evening","haEntityId":"scene.evening","entities":{}}]}'
              rows={5}
              value={rawJson}
              disabled={importing}
              onChange={(value) => onRawJsonChange?.(value)}
              style={{ layout: { width: pct(100) } }}
            />
            {onParseJson && (
              <Row justify="start">
                <HausButton
                  id="ha-scenes-import-parse-json"
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
              {`${entries.length} scenes ready`}
            </Text>
            <ScrollView
              orientation="vertical"
              style={{ layout: { width: pct(100), maxHeight: px(220) } }}
            >
              <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
                {entries.map((scene) => (
                  <Row
                    key={scene.id}
                    id={`ha-scenes-import-entry-${scene.id}`}
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
                      {`${scene.name} · ${scene.entities} devices${scene.areaName ? ` · ${scene.areaName}` : ''}`}
                    </Text>
                    <Text size={11.5} weight={600} tone={sceneStatusTone(scene, complete)}>
                      {sceneStatusText(scene, complete)}
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
                {complete ? 'Saved' : `Saving ${completed} of ${entries.length}`}
              </Text>
              <Text size={12} mono tone="muted">
                {`${percent}%`}
              </Text>
            </Row>
            <Box
              role="progressbar"
              ariaLabel="Home Assistant scene import progress"
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
            id="ha-scenes-import-error"
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
