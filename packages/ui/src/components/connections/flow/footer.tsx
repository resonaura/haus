/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import type { FlowStepRecord } from '@haus/core/transport';
import { colorToken, pct } from '../../../ir/geometry.js';
import { HausButton, Row, Text, useHausDialogClose } from '../../../primitives/index.js';
import { UiIcon } from '../../icon.js';
import type { EcosystemPluginInstallInfo } from './plugin-install.js';

export function ConfigFlowDialogFooter({
  step,
  selectedPlugin,
  pluginLoading,
  pluginInstalled,
  unsupported,
  busy,
  submitLabel,
  activeMenuKey,
  primaryFg,
  onBackFromPlugin,
  onInstallPlugin,
  onSubmitForm,
  onSelectMenu,
  onClose,
}: {
  readonly step: FlowStepRecord | null;
  readonly selectedPlugin?: EcosystemPluginInstallInfo | null;
  readonly pluginLoading: boolean;
  readonly pluginInstalled: boolean;
  readonly unsupported: boolean;
  readonly busy: boolean;
  readonly submitLabel: string;
  readonly activeMenuKey: string;
  readonly primaryFg: string;
  readonly onBackFromPlugin?: () => void;
  readonly onInstallPlugin?: () => void;
  readonly onSubmitForm: () => void;
  readonly onSelectMenu: (optionKey: string) => void;
  readonly onClose: () => void;
}): ReactNode {
  const animatedClose = useHausDialogClose() ?? onClose;
  const primaryLabel = (text: string) => (
    <Text
      size={12.5}
      style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
    >
      {text}
    </Text>
  );

  if (selectedPlugin) {
    const rtLabel =
      selectedPlugin.runtime === 'hacs'
        ? 'HACS'
        : selectedPlugin.runtime === 'homebridge'
          ? 'Homebridge'
          : selectedPlugin.runtime === 'scrypted'
            ? 'Scrypted'
            : 'Docker';
    return (
      <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
        {onBackFromPlugin && !busy ? (
          <HausButton id="plugin-install-back" variant="ghost" size="sm" onPress={onBackFromPlugin}>
            <UiIcon name="arrow-left" size={14} />
            <Text size={12.5}>Back</Text>
          </HausButton>
        ) : (
          <Row />
        )}
        <Row align="center" gapPx={8}>
          <HausButton variant="ghost" disabled={busy} onPress={animatedClose}>
            <Text size={12.5}>{pluginInstalled ? 'Done' : 'Cancel'}</Text>
          </HausButton>
          {!pluginInstalled && (
            <HausButton
              id="plugin-install-submit"
              variant="primary"
              disabled={busy || pluginLoading}
              onPress={() => onInstallPlugin?.()}
            >
              <UiIcon name={busy ? 'loader-circle' : 'plus'} size={14} color={primaryFg} />
              {primaryLabel(
                busy
                  ? 'Installing…'
                  : selectedPlugin.runtime === 'hacs'
                    ? 'Download & configure'
                    : `Install ${rtLabel} driver`,
              )}
            </HausButton>
          )}
        </Row>
      </Row>
    );
  }

  if (!step || unsupported) {
    return (
      <Row justify="end" style={{ layout: { width: pct(100) } }}>
        <HausButton variant="ghost" onPress={animatedClose}>
          <Text size={12.5}>Close</Text>
        </HausButton>
      </Row>
    );
  }

  if (step.type === 'form') {
    return (
      <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
        <HausButton variant="ghost" disabled={busy} onPress={animatedClose}>
          <Text size={12.5}>Cancel</Text>
        </HausButton>
        <HausButton id="flow-submit" variant="primary" disabled={busy} onPress={onSubmitForm}>
          {primaryLabel(busy ? 'Working…' : submitLabel)}
        </HausButton>
      </Row>
    );
  }

  if (step.type === 'menu') {
    return (
      <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
        <HausButton variant="ghost" disabled={busy} onPress={animatedClose}>
          <Text size={12.5}>Cancel</Text>
        </HausButton>
        <HausButton
          id="flow-menu-next"
          variant="primary"
          disabled={busy || !activeMenuKey}
          onPress={() => activeMenuKey && onSelectMenu(activeMenuKey)}
        >
          {primaryLabel(busy ? 'Opening…' : 'Next')}
          {!busy && <UiIcon name="arrow-right" size={14} color={primaryFg} />}
        </HausButton>
      </Row>
    );
  }

  if (step.type === 'create_entry' || step.type === 'abort') {
    return (
      <Row justify="end" style={{ layout: { width: pct(100) } }}>
        <HausButton id="flow-done" variant="primary" onPress={animatedClose}>
          {primaryLabel('Done')}
        </HausButton>
      </Row>
    );
  }

  return (
    <Row justify="end" style={{ layout: { width: pct(100) } }}>
      <HausButton variant="ghost" onPress={animatedClose}>
        <Text size={12.5}>Cancel</Text>
      </HausButton>
    </Row>
  );
}
