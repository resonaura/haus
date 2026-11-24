/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type { RenderContext } from './contract.js';
import type {
  HostCheckboxProps,
  HostFileInputProps,
  HostSelectProps,
  HostTextAreaProps,
  HostTextInputProps,
} from './host.js';
import { mergeSurfaceStyle } from './dom-helpers.js';
import { compileStyleToReactCss } from './react-dom.js';

export function DomTextInput({
  props,
  context,
}: {
  readonly props: HostTextInputProps;
  readonly context: RenderContext;
}): React.ReactElement {
  const autoListId = React.useId();
  const listId = props.suggestions?.length ? `haus-dl-${autoListId}` : undefined;
  const { style } = compileStyleToReactCss(props.style ?? {}, context);
  const mergedStyle = mergeSurfaceStyle(
    { outline: 'none', boxSizing: 'border-box', ...style },
    props.surfaceTokens,
  );
  const input = (
    <input
      ref={props.inputRef as React.Ref<HTMLInputElement> | undefined}
      id={props.id}
      name={props.name}
      type={props.inputType ?? 'text'}
      inputMode={props.inputMode}
      pattern={props.pattern}
      role={props.role}
      list={listId}
      className={props.className}
      value={props.value}
      placeholder={props.placeholder}
      min={props.min}
      max={props.max}
      step={props.step}
      maxLength={props.maxLength}
      autoComplete={props.autoComplete}
      autoCapitalize={props.autoCapitalize}
      spellCheck={props.spellCheck}
      disabled={props.disabled}
      readOnly={props.readOnly}
      required={props.required}
      autoFocus={props.autoFocus}
      aria-label={props.ariaLabel}
      aria-invalid={props.ariaInvalid}
      aria-autocomplete={props.ariaAutoComplete}
      aria-expanded={props.ariaExpanded}
      aria-controls={props.ariaControls}
      aria-activedescendant={props.ariaActiveDescendant}
      data-haus-kind="input"
      onChange={(event) => props.onChange?.(event.target.value)}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      onKeyDown={
        props.onKeyDown || props.onSubmit
          ? (event) => {
              props.onKeyDown?.({
                key: event.key,
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                target: event.target,
                currentTarget: event.currentTarget,
                preventDefault: () => event.preventDefault(),
                stopPropagation: () => event.stopPropagation(),
              });
              if (
                event.key === 'Enter' &&
                !event.defaultPrevented &&
                !event.nativeEvent.isComposing &&
                props.onSubmit
              ) {
                event.preventDefault();
                props.onSubmit();
              }
            }
          : undefined
      }
      style={mergedStyle}
    />
  );
  if (!listId || !props.suggestions?.length) return input;
  return (
    <>
      {input}
      <datalist id={listId}>
        {props.suggestions.map((entry) =>
          typeof entry === 'string' ? (
            <option key={entry} value={entry} />
          ) : (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ),
        )}
      </datalist>
    </>
  );
}

export function DomTextArea({
  props,
  context,
}: {
  readonly props: HostTextAreaProps;
  readonly context: RenderContext;
}): React.ReactElement {
  const internalRef = React.useRef<HTMLTextAreaElement | null>(null);
  React.useEffect(() => {
    internalRef.current?.setCustomValidity(props.customValidity ?? '');
  }, [props.customValidity]);
  const assignRef = (node: HTMLTextAreaElement | null) => {
    internalRef.current = node;
    const external = props.textAreaRef;
    if (typeof external === 'function') external(node);
    else if (external && typeof external === 'object' && 'current' in external) {
      (external as React.MutableRefObject<unknown>).current = node;
    }
  };
  const { style } = compileStyleToReactCss(props.style ?? {}, context);
  return (
    <textarea
      ref={assignRef}
      id={props.id}
      name={props.name}
      className={props.className}
      value={props.value}
      rows={props.rows ?? 4}
      placeholder={props.placeholder}
      disabled={props.disabled}
      readOnly={props.readOnly}
      required={props.required}
      spellCheck={props.spellCheck}
      aria-label={props.ariaLabel}
      data-haus-kind="textarea"
      onChange={(event) => props.onChange?.(event.target.value)}
      style={{ outline: 'none', boxSizing: 'border-box', ...style }}
    />
  );
}

export function DomSelect({
  props,
  context,
}: {
  readonly props: HostSelectProps;
  readonly context: RenderContext;
}): React.ReactElement {
  const { style } = compileStyleToReactCss(props.style ?? {}, context);
  const mergedStyle = mergeSurfaceStyle(style, props.surfaceTokens);
  return (
    <select
      id={props.id}
      name={props.name}
      className={props.className}
      multiple={props.multiple}
      value={props.multiple ? [...(props.values ?? [])] : props.value}
      disabled={props.disabled}
      required={props.required}
      aria-label={props.ariaLabel}
      aria-invalid={props.ariaInvalid}
      data-haus-kind="select"
      onChange={(event) => {
        if (props.multiple) {
          props.onMultiChange?.([...event.target.selectedOptions].map((opt) => opt.value));
        } else {
          props.onChange?.(event.target.value);
        }
      }}
      style={mergedStyle}
    >
      {props.options.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function DomCheckbox({
  props,
  context,
}: {
  readonly props: HostCheckboxProps;
  readonly context: RenderContext;
}): React.ReactElement {
  const ref = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(props.indeterminate);
  }, [props.indeterminate]);
  const { style } = compileStyleToReactCss(props.style ?? {}, context);
  return (
    <input
      ref={ref}
      id={props.id}
      name={props.name}
      type="checkbox"
      className={props.className}
      checked={props.checked}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      data-haus-kind="checkbox"
      onClick={props.stopPropagation ? (event) => event.stopPropagation() : undefined}
      onChange={(event) => props.onChange?.(event.target.checked)}
      style={style}
    />
  );
}

export function DomFileInput({
  props,
  context,
}: {
  readonly props: HostFileInputProps;
  readonly context: RenderContext;
}): React.ReactElement {
  const { style } = compileStyleToReactCss(props.style ?? {}, context);
  return (
    <input
      id={props.id}
      type="file"
      className={props.className}
      accept={props.accept}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      data-haus-kind="file-input"
      onChange={(event) => props.onFileChange?.(event.currentTarget.files?.[0])}
      style={style}
    />
  );
}
