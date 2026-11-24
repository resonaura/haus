/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import {
  filterIntegrationChoices,
  normalizeFlowMenuOptions,
  substituteFlowPlaceholders,
  type FlowStepRecord,
  type IntegrationCatalogChoice,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  HausButton,
  HausDialog,
  Pressable,
  Row,
  ScrollView,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import { FlowFieldInput, humanizeFlowSlug } from './config-flow-fields.js';

export interface ConfigFlowModalProps {
  readonly title: string;
  readonly step: FlowStepRecord | null;
  readonly catalog: readonly IntegrationCatalogChoice[];
  readonly pickerQuery: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly busy?: boolean;
  readonly error?: string;
  readonly onPickerQueryChange: (query: string) => void;
  readonly onStartDomain: (choice: IntegrationCatalogChoice) => void;
  readonly onChangeValues: (values: Record<string, unknown>) => void;
  readonly onSubmitForm: () => void;
  readonly onSelectMenu: (optionKey: string) => void;
  readonly onOpenExternalUrl: (url: string) => void;
  readonly onClose: () => void;
}

export function ConfigFlowModal({
  title,
  step,
  catalog,
  pickerQuery,
  values,
  fieldErrors,
  busy = false,
  error,
  onPickerQueryChange,
  onStartDomain,
  onChangeValues,
  onSubmitForm,
  onSelectMenu,
  onOpenExternalUrl,
  onClose,
}: ConfigFlowModalProps) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
  const [selectedMenuKey, setSelectedMenuKey] = useState('');
  const filteredCatalog = filterIntegrationChoices(catalog, pickerQuery);
  const menuOptions = step?.type === 'menu' ? normalizeFlowMenuOptions(step) : [];
  const activeMenuKey = menuOptions.some((o) => o.key === selectedMenuKey)
    ? selectedMenuKey
    : (menuOptions[0]?.key ?? '');

  const primaryLabel = (text: string) => (
    <Text size={12.5} style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}>
      {text}
    </Text>
  );

  const descriptionText = step?.description
    ? substituteFlowPlaceholders(step.description, step.description_placeholders)
    : undefined;
  const dialogTitle = step?.title
    ? substituteFlowPlaceholders(step.title, step.description_placeholders)
    : title;

  const footer = (() => {
    if (!step) {
      return (
        <Row justify="end" style={{ layout: { width: pct(100) } }}>
          <HausButton variant="ghost" onPress={onClose}>
            <Text size={12.5}>Close</Text>
          </HausButton>
        </Row>
      );
    }
    if (step.type === 'form') {
      return (
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton variant="ghost" disabled={busy} onPress={onClose}>
            <Text size={12.5}>Cancel</Text>
          </HausButton>
          <HausButton id="flow-submit" variant="primary" disabled={busy} onPress={onSubmitForm}>
            {primaryLabel(busy ? 'Working…' : (step.submit_label ?? 'Submit'))}
          </HausButton>
        </Row>
      );
    }
    if (step.type === 'menu') {
      return (
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton variant="ghost" disabled={busy} onPress={onClose}>
            <Text size={12.5}>Cancel</Text>
          </HausButton>
          <HausButton
            id="flow-menu-next"
            variant="primary"
            disabled={busy || !activeMenuKey}
            onPress={() => activeMenuKey && onSelectMenu(activeMenuKey)}
          >
            {primaryLabel(busy ? 'Opening…' : 'Next')}
          </HausButton>
        </Row>
      );
    }
    if (step.type === 'create_entry' || step.type === 'abort') {
      return (
        <Row justify="end" style={{ layout: { width: pct(100) } }}>
          <HausButton id="flow-done" variant="primary" onPress={onClose}>
            {primaryLabel('Done')}
          </HausButton>
        </Row>
      );
    }
    return (
      <Row justify="end" style={{ layout: { width: pct(100) } }}>
        <HausButton variant="ghost" onPress={onClose}>
          <Text size={12.5}>Cancel</Text>
        </HausButton>
      </Row>
    );
  })();

  return (
    <HausDialog size="md" title={dialogTitle} scrollable onClose={onClose} footer={footer}>
      <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
        {error && <Text size={12} tone="critical">{error}</Text>}

        {!step && (
          <Stack gapPx={12}>
            <TextInput
              id="flow-picker-search"
              ariaLabel="Search integrations"
              placeholder="Search integrations…"
              value={pickerQuery}
              onChange={onPickerQueryChange}
              style={{
                layout: { width: pct(100), minHeight: px(38), padding: insets(8, 12) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(12),
                typography: { size: 13, color: colorToken('textPrimary') },
              }}
            />
            <ScrollView style={{ layout: { width: pct(100), maxHeight: px(340) } }}>
              <Stack gapPx={8}>
                {filteredCatalog.map((item) => (
                  <Row
                    key={item.domain}
                    align="center"
                    justify="between"
                    gapPx={12}
                    style={{
                      layout: { width: pct(100), padding: insets(10, 14) },
                      material: new SolidMaterial(colorToken('surfaceSecondary')),
                      border: { width: 1, color: colorToken('border') },
                      corners: corners(12),
                    }}
                  >
                    <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                      <Text size={13} weight={600}>
                        {item.title}
                      </Text>
                      <Text size={11.5} tone="muted">
                        {item.subtitle ?? item.domain}
                      </Text>
                    </Stack>
                    <HausButton
                      id={`flow-picker-${item.domain}`}
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onPress={() => onStartDomain(item)}
                    >
                      <Text size={12}>Set up</Text>
                    </HausButton>
                  </Row>
                ))}
              </Stack>
            </ScrollView>
          </Stack>
        )}

        {step?.type === 'form' && (
          <Stack gapPx={12}>
            <Text size={12.5} tone="muted">
              {descriptionText ||
                (step.data_schema?.length
                  ? 'Enter the details for this connection.'
                  : 'Continue when your device is ready.')}
            </Text>
            {step.errors?.base && (
              <Text size={12} tone="critical">
                {humanizeFlowSlug(step.errors.base)}
              </Text>
            )}
            {(step.data_schema ?? []).map((field) => (
              <FlowFieldInput
                key={field.name}
                field={field}
                step={step}
                value={values[field.name]}
                error={fieldErrors[field.name] ?? step.errors?.[field.name]}
                disabled={busy}
                onChange={(nextVal) => onChangeValues({ ...values, [field.name]: nextVal })}
              />
            ))}
          </Stack>
        )}

        {step?.type === 'menu' && (
          <Stack gapPx={8}>
            {descriptionText && <Text size={12.5} tone="muted">{descriptionText}</Text>}
            {menuOptions.map((opt) => {
              const selected = activeMenuKey === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  id={`flow-menu-${opt.key}`}
                  ariaPressed={selected}
                  disabled={busy}
                  onActivate={() => setSelectedMenuKey(opt.key)}
                  style={{
                    layout: { width: pct(100), padding: insets(12, 14) },
                    material: new SolidMaterial(
                      selected ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                    ),
                    border: { width: 1, color: selected ? colorToken('accent') : colorToken('border') },
                    corners: corners(12),
                  }}
                >
                  <Stack gapPx={2}>
                    <Text size={13} weight={600}>
                      {opt.label}
                    </Text>
                    {opt.description && <Text size={11.5} tone="muted">{opt.description}</Text>}
                  </Stack>
                </Pressable>
              );
            })}
          </Stack>
        )}

        {step?.type === 'external' && (
          <Stack gapPx={12}>
            <Text size={12.5} tone="muted">
              {descriptionText ||
                'Sign in through your browser to authorize this integration with Haus.'}
            </Text>
            {step.url && (
              <HausButton
                id="flow-open-external"
                variant="primary"
                onPress={() => onOpenExternalUrl(step.url ?? '')}
              >
                <UiIcon name="external-link" size={14} color={primaryFg} />
                {primaryLabel('Open authentication page')}
              </HausButton>
            )}
            <Text size={11.5} tone="muted">
              Waiting for authorization to finish…
            </Text>
          </Stack>
        )}

        {step?.type === 'progress' && (
          <Row align="center" gapPx={10}>
            <UiIcon name="loader-circle" size={16} />
            <Text size={13} tone="muted">
              {descriptionText ||
                (step.progress_action ? humanizeFlowSlug(step.progress_action) : 'Working…')}
            </Text>
          </Row>
        )}

        {step?.type === 'create_entry' && (
          <Row
            align="center"
            gapPx={10}
            style={{
              layout: { width: pct(100), padding: insets(14) },
              material: new SolidMaterial(rgba(52, 211, 153, 0.12)),
              border: { width: 1, color: rgba(52, 211, 153, 0.36) },
              corners: corners(12),
            }}
          >
            <UiIcon name="check-circle" size={18} color="#34d399" />
            <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
              <Text size={13.5} weight={600}>
                {`Connected ${step.result?.title ?? step.title ?? humanizeFlowSlug(step.handler)}`}
              </Text>
              <Text size={12} tone="muted">
                {descriptionText || 'Integration setup completed and saved on your Hub.'}
              </Text>
            </Stack>
          </Row>
        )}

        {step?.type === 'abort' && (
          <Row
            align="center"
            gapPx={10}
            style={{
              layout: { width: pct(100), padding: insets(14) },
              material: new SolidMaterial(colorToken('surfaceSecondary')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(12),
            }}
          >
            <UiIcon name="alert-circle" size={17} />
            <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
              <Text size={13} weight={600}>
                {step.reason ? humanizeFlowSlug(step.reason) : 'Setup ended'}
              </Text>
              {descriptionText && <Text size={12} tone="muted">{descriptionText}</Text>}
            </Stack>
          </Row>
        )}
      </Stack>
    </HausDialog>
  );
}
