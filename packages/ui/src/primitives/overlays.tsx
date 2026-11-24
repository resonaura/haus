/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type { UiStyleSpec } from '../ir/node.js';
import { dialogStyles, fieldStyles } from '../styles/overlays.js';
import { composeStyles } from '../styles/sheet.js';
import { useHausStyles, useHausUi } from './context.js';
import {
  Box,
  Divider,
  Heading,
  Pressable,
  Row,
  ScrollView,
  SelectInput,
  Stack,
  Text,
  TextInput,
} from './elements.js';

export interface HausScrollAreaProps {
  readonly id?: string;
  readonly className?: string;
  readonly orientation?: 'vertical' | 'horizontal';
  readonly size?: number;
  readonly hideScrollBar?: boolean;
  readonly hidden?: boolean;
  readonly isEnabled?: boolean;
  readonly role?: string;
  readonly 'aria-label'?: string;
  readonly onScroll?: () => void;
  readonly ref?: React.Ref<unknown>;
  readonly scrollRef?: React.Ref<unknown>;
  readonly style?: UiStyleSpec;
  readonly children?: React.ReactNode;
}

export function HausScrollArea({
  id,
  className,
  orientation = 'vertical',
  size = 24,
  hideScrollBar = false,
  hidden,
  isEnabled,
  role,
  'aria-label': ariaLabel,
  onScroll,
  ref,
  scrollRef,
  style,
  children,
}: HausScrollAreaProps): React.ReactElement {
  return (
    <ScrollView
      id={id}
      className={className}
      orientation={orientation}
      shadowSizePx={size}
      hideScrollBar={hideScrollBar}
      hidden={hidden}
      isEnabled={isEnabled}
      role={role}
      ariaLabel={ariaLabel}
      onScroll={onScroll}
      scrollRef={scrollRef ?? ref}
      style={style}
    >
      {children}
    </ScrollView>
  );
}

export interface HausDialogProps {
  readonly open?: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly size?: 'sm' | 'md' | 'lg' | 'xl' | 'adaptive' | 'cover';
  readonly backdrop?: 'blur' | 'liquid-glass' | 'dim';
  readonly scrollable?: boolean;
  readonly chromeless?: boolean;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly footer?: React.ReactNode;
  readonly onClose: () => void;
  readonly children?: React.ReactNode;
}

export function HausDialog({
  open = true,
  title,
  subtitle,
  size = 'md',
  backdrop = 'blur',
  scrollable = true,
  chromeless = false,
  className,
  style,
  footer,
  onClose,
  children,
}: HausDialogProps): React.ReactElement | null {
  const ctx = useHausUi();
  const styles = useHausStyles(dialogStyles, { size, backdrop });

  React.useEffect(() => {
    if (!open || ctx.contentHost.renderDialogFrame) return undefined;
    return ctx.host.subscribeEscape?.(onClose);
  }, [open, onClose, ctx.host, ctx.contentHost]);

  if (!open) return null;

  const context = (
    <>
      <Row style={styles.header} className="modal__header">
        <Stack gapPx={4}>
          <Heading level={2} className="modal__heading">
            {title}
          </Heading>
          {subtitle && (
            <Text tone="muted" size={13}>
              {subtitle}
            </Text>
          )}
        </Stack>
        <Pressable id="dialog-close" ariaLabel="Close dialog" style={styles.closeButton} onActivate={onClose}>
          ×
        </Pressable>
      </Row>
      <Box className="modal__body">
        {scrollable ? (
          <HausScrollArea
            className="haus-dialog-scroll"
            orientation="vertical"
            size={24}
            hideScrollBar
          >
            {children}
          </HausScrollArea>
        ) : (
          children
        )}
      </Box>
      {footer && (
        <Row style={styles.footer} className="modal__footer">
          {footer}
        </Row>
      )}
    </>
  );
  const panel = composeStyles(styles.panel, style);
  const content = chromeless ? children : context;
  if (ctx.contentHost.renderDialogFrame) {
    return ctx.contentHost.renderDialogFrame(
      { title, onClose, backdrop: styles.backdrop, panel, children: content },
      ctx,
    );
  }

  const dialog = (
    <Box style={styles.backdrop} onBackdropPress={onClose} dataKind="dialog-backdrop">
      <Box
        role="dialog"
        ariaModal
        ariaLabel={title}
        dataKind="modal"
        className={['haus-dialog', className].filter(Boolean).join(' ')}
        style={panel}
      >
        {content}
      </Box>
    </Box>
  );

  return <>{ctx.portal ? ctx.portal(dialog) : dialog}</>;
}

export interface HausTextFieldProps {
  readonly id?: string;
  readonly value: string;
  readonly type?: 'text' | 'password' | 'email' | 'url' | 'number' | 'search' | 'color';
  readonly label?: string;
  readonly description?: string;
  readonly error?: string;
  readonly placeholder?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly maxLength?: number;
  readonly autoComplete?: string;
  readonly spellCheck?: boolean;
  readonly disabled?: boolean;
  readonly isDisabled?: boolean;
  readonly required?: boolean;
  readonly isRequired?: boolean;
  readonly autoFocus?: boolean;
  readonly 'aria-label'?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onChange?: (value: string) => void;
}

export function HausTextField({
  id,
  value,
  type = 'text',
  label,
  description,
  error,
  placeholder,
  min,
  max,
  step,
  maxLength,
  autoComplete,
  spellCheck,
  disabled,
  isDisabled,
  required,
  isRequired,
  autoFocus,
  'aria-label': ariaLabel,
  className,
  style,
  onChange,
}: HausTextFieldProps): React.ReactElement {
  const effectiveDisabled = disabled ?? isDisabled;
  const effectiveRequired = required ?? isRequired;
  const styles = useHausStyles(fieldStyles, {
    error: Boolean(error),
    disabled: effectiveDisabled,
  });

  return (
    <Stack className={className} style={composeStyles(styles.root, style)} gapPx={6}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        id={id}
        inputType={type}
        value={value}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        disabled={effectiveDisabled}
        required={effectiveRequired}
        autoFocus={autoFocus}
        ariaLabel={ariaLabel ?? label}
        style={styles.input}
        onChange={onChange}
      />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : description ? (
        <Text style={styles.description}>{description}</Text>
      ) : null}
    </Stack>
  );
}

export interface HausSelectOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
}

export interface HausSelectProps<T extends string = string> {
  readonly id?: string;
  readonly value: T;
  readonly options: readonly HausSelectOption<T>[];
  readonly label?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly 'aria-label'?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onChange: (value: T) => void;
}

export function HausSelect<T extends string = string>({
  id,
  value,
  options,
  label,
  disabled,
  required,
  'aria-label': ariaLabel,
  className,
  style,
  onChange,
}: HausSelectProps<T>): React.ReactElement {
  const styles = useHausStyles(fieldStyles, { disabled });

  return (
    <SelectInput
      id={id}
      className={className}
      value={value}
      options={options}
      disabled={disabled}
      required={required}
      ariaLabel={ariaLabel ?? label}
      style={composeStyles(styles.select, style)}
      onChange={(next) => onChange(next as T)}
    />
  );
}

export const HausDivider = Divider;

export function HausLabel({
  children,
  className,
  style,
}: {
  readonly children?: React.ReactNode;
  readonly className?: string;
  readonly style?: UiStyleSpec;
}): React.ReactElement {
  return (
    <Text className={className} size={13} weight={500} style={style}>
      {children}
    </Text>
  );
}

export function HausDescription({
  children,
  className,
  style,
}: {
  readonly children?: React.ReactNode;
  readonly className?: string;
  readonly style?: UiStyleSpec;
}): React.ReactElement {
  return (
    <Text className={className} tone="muted" size={11.5} style={style}>
      {children}
    </Text>
  );
}
