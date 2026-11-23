/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type { UiStyleSpec } from '../ir/node.js';
import type {
  HostCodeProps,
  HostDisclosureProps,
  HostFormProps,
  HostTextAreaProps,
} from '../renderers/host.js';
import { codeStyles, popoverStyles, toastStyles, type HausToastTone } from '../styles/feedback.js';
import { fieldStyles } from '../styles/overlays.js';
import { composeStyles } from '../styles/sheet.js';
import { useHausStyles, useHausUi } from './context.js';
import { Box, Divider, Pressable, Row, Stack, Text } from './elements.js';

export interface HausToastEntry {
  readonly id: string;
  readonly title: string;
  readonly tone: HausToastTone;
}

export interface HausToastOptions {
  readonly timeout?: number;
  readonly onClose?: () => void;
}

/**
 * Pure TypeScript OOP toast queue — zero DOM/HeroUI dependencies.
 * Deduplicates and bounds visible notices across Desktop, Mobile, and Native renderers.
 */
export class HausToastQueue {
  private items: HausToastEntry[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly closeCallbacks = new Map<string, () => void>();
  private readonly listeners = new Set<() => void>();
  private sequence = 0;

  constructor(private readonly maxVisible = 3) {}

  getSnapshot = (): readonly HausToastEntry[] => this.items;

  get visibleToasts(): ReadonlyArray<{
    readonly key: string;
    readonly content: { readonly title: string; readonly variant: HausToastTone };
  }> {
    return this.items.map((item) => ({
      key: item.id,
      content: { title: item.title, variant: item.tone },
    }));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  add(title: string, tone: HausToastTone = 'default', options: HausToastOptions = {}): string {
    const id = `toast-${++this.sequence}`;
    if (options.onClose) this.closeCallbacks.set(id, options.onClose);
    const next = [...this.items, { id, title, tone }];
    if (next.length > this.maxVisible) {
      const evicted = next.shift();
      if (evicted) this.cleanupItem(evicted.id);
    }
    this.items = next;
    this.scheduleTimeout(id, options.timeout);
    this.emit();
    return id;
  }

  update(
    id: string,
    title: string,
    tone: HausToastTone = 'default',
    options: HausToastOptions = {},
  ): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return false;
    this.items = this.items.map((item) => (item.id === id ? { id, title, tone } : item));
    this.scheduleTimeout(id, options.timeout);
    this.emit();
    return true;
  }

  remove(id: string): void {
    const existed = this.items.some((item) => item.id === id);
    if (!existed) return;
    this.items = this.items.filter((item) => item.id !== id);
    this.cleanupItem(id);
    this.emit();
  }

  clear(): void {
    for (const item of this.items) {
      this.cleanupItem(item.id);
    }
    this.items = [];
    this.emit();
  }

  destroy(): void {
    this.clear();
    this.listeners.clear();
  }

  private scheduleTimeout(id: string, timeout?: number): void {
    const existing = this.timers.get(id);
    if (existing) clearTimeout(existing);
    if (timeout && timeout > 0) {
      this.timers.set(
        id,
        setTimeout(() => this.remove(id), timeout),
      );
    }
  }

  private cleanupItem(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    const onClose = this.closeCallbacks.get(id);
    this.closeCallbacks.delete(id);
    onClose?.();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export interface HausToastRegionProps {
  readonly queue: HausToastQueue;
  readonly className?: string;
  readonly 'aria-label'?: string;
}

export function HausToastRegion({
  queue,
  className,
  'aria-label': ariaLabel = 'Notifications',
}: HausToastRegionProps): React.ReactElement | null {
  const ctx = useHausUi();
  const toasts = React.useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const baseStyles = useHausStyles(toastStyles, 'default');

  if (toasts.length === 0) return null;

  const region = (
    <Box
      role="region"
      ariaLabel={ariaLabel}
      className={['haus-toast-region', className].filter(Boolean).join(' ')}
      style={baseStyles.region}
      dataKind="toast-region"
    >
      {toasts.map((item) => (
        <HausToastCard key={item.id} item={item} onDismiss={() => queue.remove(item.id)} />
      ))}
    </Box>
  );

  return <>{ctx.portal ? ctx.portal(region) : region}</>;
}

function HausToastCard({
  item,
  onDismiss,
}: {
  readonly item: HausToastEntry;
  readonly onDismiss: () => void;
}): React.ReactElement {
  const styles = useHausStyles(toastStyles, item.tone);
  return (
    <Row role="status" className="haus-toast" style={styles.card} dataKind="toast">
      <Box style={styles.indicator} />
      <Text style={styles.title}>{item.title}</Text>
      <Pressable ariaLabel="Dismiss notification" style={styles.closeButton} onPress={onDismiss}>
        ×
      </Pressable>
    </Row>
  );
}

export interface HausPopoverProps {
  readonly open: boolean;
  readonly placement?: 'top' | 'bottom' | 'left' | 'right';
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onOpenChange: (open: boolean) => void;
  readonly trigger: React.ReactNode;
  readonly children: React.ReactNode;
}

export function HausPopover({
  open,
  placement = 'bottom',
  className,
  style,
  onOpenChange,
  trigger,
  children,
}: HausPopoverProps): React.ReactElement {
  const ctx = useHausUi();
  const styles = useHausStyles(popoverStyles, placement);

  React.useEffect(() => {
    if (!open) return undefined;
    return ctx.host.subscribeEscape?.(() => onOpenChange(false));
  }, [open, onOpenChange, ctx.host]);

  return (
    <Box style={styles.anchor} dataKind="popover-anchor">
      {trigger}
      {open && (
        <Box
          role="dialog"
          className={className}
          style={composeStyles(styles.surface, style)}
          dataKind="popover"
        >
          {children}
        </Box>
      )}
    </Box>
  );
}

export interface HausMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: React.ReactNode;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly separatorBefore?: boolean;
  readonly onAction: () => void;
}

export interface HausMenuProps {
  readonly open: boolean;
  readonly placement?: 'top' | 'bottom' | 'left' | 'right';
  readonly items: readonly HausMenuItem[];
  readonly onOpenChange: (open: boolean) => void;
  readonly trigger: React.ReactNode;
}

export function HausMenu({
  open,
  placement = 'bottom',
  items,
  onOpenChange,
  trigger,
}: HausMenuProps): React.ReactElement {
  const styles = useHausStyles(popoverStyles, placement);

  return (
    <HausPopover open={open} placement={placement} onOpenChange={onOpenChange} trigger={trigger}>
      <Stack gapPx={2} role="menu">
        {items.map((item) => (
          <React.Fragment key={item.id}>
            {item.separatorBefore && <Divider />}
            <Pressable
              role="menuitem"
              disabled={item.disabled}
              style={item.danger ? styles.menuDanger : styles.menuItem}
              onPress={() => {
                onOpenChange(false);
                item.onAction();
              }}
            >
              {item.icon}
              <Text tone={item.danger ? 'critical' : 'primary'} size={12.5} weight={500}>
                {item.label}
              </Text>
            </Pressable>
          </React.Fragment>
        ))}
      </Stack>
    </HausPopover>
  );
}

export function HausForm(props: HostFormProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderForm(props, ctx);
}

export interface HausTextAreaProps extends HostTextAreaProps {
  readonly label?: string;
  readonly description?: string;
  readonly error?: string;
}

export function HausTextArea({
  label,
  description,
  error,
  style,
  ...rest
}: HausTextAreaProps): React.ReactElement {
  const ctx = useHausUi();
  const styles = useHausStyles(fieldStyles, { error: Boolean(error), disabled: rest.disabled });
  const inputEl = ctx.host.renderTextArea(
    { ...rest, ariaLabel: rest.ariaLabel ?? label, style: composeStyles(styles.input, style) },
    ctx,
  );
  if (!label && !description && !error) return inputEl;
  return (
    <Stack gapPx={6}>
      {label && <Text style={styles.label}>{label}</Text>}
      {inputEl}
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : description ? (
        <Text style={styles.description}>{description}</Text>
      ) : null}
    </Stack>
  );
}

export function HausCode({ block, style, ...rest }: HostCodeProps): React.ReactElement {
  const ctx = useHausUi();
  const styles = useHausStyles(codeStyles, undefined);
  return ctx.host.renderCode(
    { ...rest, block, style: composeStyles(block ? styles.block : styles.inline, style) },
    ctx,
  );
}

export function HausDisclosure(props: HostDisclosureProps): React.ReactElement {
  const ctx = useHausUi();
  return ctx.host.renderDisclosure(props, ctx);
}
