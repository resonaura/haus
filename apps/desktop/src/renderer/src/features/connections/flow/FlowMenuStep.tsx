/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowRight } from 'lucide-react';
import type { FlowStep } from '../../../ha/management';
import { extractMenuOptions } from './flow-helpers';

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
      <p className="management-hint">
        No setup actions were returned for this step. Go back or cancel to choose another
        integration.
      </p>
    );
  }

  return (
    <div className="flow-action-step">
      <div className="flow-action-heading">{description || 'Action'}</div>
      <div
        className="flow-action-list"
        role="radiogroup"
        aria-label={step.title || 'Select Action'}
      >
        {options.map((opt) => {
          const isSelected = selected === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`flow-action-option ${isSelected ? 'is-selected' : ''}`}
              disabled={busy}
              onClick={() => setSelected(opt.key)}
              onDoubleClick={() => !busy && onNext(opt.key)}
            >
              <span className="flow-radio-dot" aria-hidden="true" />
              <span className="flow-action-copy">
                <strong>{opt.label}</strong>
                {opt.description && <small>{opt.description}</small>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flow-action-footer">
        <Button
          type="button"
          className="flow-next-pill"
          isDisabled={busy || !selected}
          isPending={busy}
          onPress={() => selected && onNext(selected)}
        >
          {busy ? 'Opening…' : 'Next'}
          {!busy && <ArrowRight size={15} />}
        </Button>
      </div>
    </div>
  );
}
