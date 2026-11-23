/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { Box, HausButton, HausForm, Pressable, Text } from '@haus/ui';
import { ArrowRight } from 'lucide-react';
import { SchemaFields } from '../../../components/forms/SchemaForm';
import { ServerMarkdown } from '../../../components/ui/ServerMarkdown';
import type { FlowStep } from '../../../ha/management';
import type { Snapshot } from '../../../model';
import { extractMenuOptions, type FlowLocalizationHelpers } from './flow-helpers';

export function FlowFormStep({
  step,
  values,
  clientErrors,
  snapshot,
  localization,
  onChangeValues,
  onChangeClientErrors,
  onSubmit,
}: {
  step: FlowStep;
  values: Record<string, unknown>;
  clientErrors: Record<string, string>;
  snapshot: Snapshot;
  localization: FlowLocalizationHelpers;
  onChangeValues: (nextValues: Record<string, unknown>) => void;
  onChangeClientErrors: (nextErrors: Record<string, string>) => void;
  onSubmit: () => void;
}) {
  const { text, humanizeSlug, fieldLabel, fieldDescription, selectorOptions } = localization;
  const mergedFormErrors = { ...step.errors, ...clientErrors };
  return (
    <HausForm id="integration-setup-form" noValidate onSubmit={onSubmit}>
      <Box className="flow-description">
        <ServerMarkdown
          text={text(
            `step.${step.step_id}.description`,
            step.description ||
              (step.data_schema?.length
                ? 'Enter the details for this connection.'
                : 'Continue when your device is ready.'),
          )}
        />
      </Box>
      {step.errors?.base && (
        <Text semantic="p" role="alert" className="form-error">
          {text(`error.${step.errors.base}`, humanizeSlug(step.errors.base))}
        </Text>
      )}
      <SchemaFields
        key={`${step.flow_id}:${step.step_id}`}
        schema={step.data_schema ?? []}
        values={values}
        onChange={(nextValues) => {
          onChangeValues(nextValues);
          if (Object.keys(clientErrors).length > 0) {
            onChangeClientErrors(
              Object.fromEntries(
                Object.entries(clientErrors).filter(([k]) => nextValues[k] === values[k]),
              ),
            );
          }
        }}
        snapshot={snapshot}
        label={fieldLabel}
        description={fieldDescription}
        selectorOptions={selectorOptions}
        errors={Object.fromEntries(
          Object.entries(mergedFormErrors).map(([key, value]) => [
            key,
            text(`error.${value}`, humanizeSlug(value)),
          ]),
        )}
      />
    </HausForm>
  );
}

export function FlowMenuStep({
  step,
  menuLabels,
  description,
  busy,
  humanize,
  onNext,
}: {
  step: FlowStep;
  menuLabels: Record<string, string>;
  description?: string;
  busy: boolean;
  humanize: (value: string) => string;
  onNext: (choiceKey: string) => void;
}) {
  const options = extractMenuOptions(step, menuLabels, humanize);
  const [selected, setSelected] = useState<string>(() => options[0]?.key ?? '');

  useEffect(() => {
    setSelected((prev) => (options.some((o) => o.key === prev) ? prev : (options[0]?.key ?? '')));
  }, [step.flow_id, step.step_id, options.length]);

  if (options.length === 0) {
    return (
      <Text semantic="p" className="management-hint">
        No setup actions were returned for this step. Go back or cancel to choose another
        integration.
      </Text>
    );
  }

  return (
    <Box className="flow-action-step">
      <Box className="flow-action-heading">{description || 'Action'}</Box>
      <Box className="flow-action-list" role="radiogroup" ariaLabel={step.title || 'Select Action'}>
        {options.map((opt) => {
          const isSelected = selected === opt.key;
          return (
            <Pressable
              key={opt.key}
              role="radio"
              ariaChecked={isSelected}
              className={`flow-action-option ${isSelected ? 'is-selected' : ''}`}
              disabled={busy}
              onPress={() => setSelected(opt.key)}
              onDoublePress={() => !busy && onNext(opt.key)}
            >
              <Text className="flow-radio-dot" ariaHidden />
              <Text className="flow-action-copy">
                <Text semantic="strong">{opt.label}</Text>
                {opt.description && <Text semantic="small">{opt.description}</Text>}
              </Text>
            </Pressable>
          );
        })}
      </Box>
      <Box className="flow-action-footer">
        <HausButton
          type="button"
          className="flow-next-pill"
          isDisabled={busy || !selected}
          isPending={busy}
          onPress={() => selected && onNext(selected)}
        >
          {busy ? 'Opening…' : 'Next'}
          {!busy && <ArrowRight size={15} />}
        </HausButton>
      </Box>
    </Box>
  );
}
