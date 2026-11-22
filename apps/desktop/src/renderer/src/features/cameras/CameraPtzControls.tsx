/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button } from '@heroui/react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleStop,
  Home,
  Move,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { buildAction, type HassEntity } from '../../model';
import type { Action } from '../../hooks/useHaus';
import { cameraPtzButtons } from './ptz-controls';

interface PanelPosition {
  top: number;
  right: number;
  origin: 'top right' | 'bottom right';
}

export function CameraPtzControls({
  entities,
  onAction,
  onError,
}: {
  entities: HassEntity[];
  onAction: (action: Action) => Promise<void>;
  onError: (reason: unknown) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const controls = useMemo(() => cameraPtzButtons(entities), [entities]);

  const updatePosition = useCallback(() => {
    const triggerEl = trigger.current;
    const host = root.current?.closest<HTMLElement>('.camera-dialog') ?? document.body;
    if (!triggerEl || !host) return;
    const hostRect = host.getBoundingClientRect();
    const triggerRect = triggerEl.getBoundingClientRect();
    const panelHeight = panel.current?.offsetHeight || 220;
    const right = Math.max(12, hostRect.right - triggerRect.right);
    const belowTop = triggerRect.bottom - hostRect.top + 10;
    const fitsBelow = belowTop + panelHeight <= hostRect.height - 12;
    const top = fitsBelow
      ? belowTop
      : Math.max(12, triggerRect.top - hostRect.top - panelHeight - 10);
    setPosition({ top, right, origin: fitsBelow ? 'top right' : 'bottom right' });
  }, []);

  useEffect(() => {
    if (open) {
      setPanelMounted(true);
      return;
    }
    const timeout = window.setTimeout(() => setPanelMounted(false), 180);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useLayoutEffect(() => {
    if (!panelMounted) return;
    updatePosition();
    const host = root.current?.closest<HTMLElement>('.camera-dialog');
    const onLayout = () => updatePosition();
    window.addEventListener('resize', onLayout);
    document.addEventListener('fullscreenchange', onLayout);
    const observer =
      host && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onLayout) : undefined;
    if (host && observer) observer.observe(host);
    return () => {
      window.removeEventListener('resize', onLayout);
      document.removeEventListener('fullscreenchange', onLayout);
      observer?.disconnect();
    };
  }, [panelMounted, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  if (!controls) return null;

  const press = (entity: HassEntity | undefined) => {
    if (!entity || entity.state === 'unavailable') return;
    void onAction(buildAction(entity, 'press')).catch(onError);
  };
  const control = (
    entity: HassEntity | undefined,
    label: string,
    icon: ReactNode,
    className = '',
  ) => (
    <Button
      key={label}
      isIconOnly
      variant="ghost"
      className={`camera-ptz-button ${className}`}
      aria-label={label}
      isDisabled={!entity || entity.state === 'unavailable'}
      onPress={() => press(entity)}
    >
      {icon}
    </Button>
  );

  const portalHost =
    root.current?.closest<HTMLElement>('.camera-dialog') ??
    (typeof document !== 'undefined' ? document.body : null);

  const panelNode = panelMounted ? (
    <section
      id="camera-ptz-panel"
      ref={panel}
      className={`camera-ptz-panel${open ? '' : ' is-closing'}`}
      style={
        position
          ? { top: position.top, right: position.right, transformOrigin: position.origin }
          : undefined
      }
      aria-label="Camera movement controls"
      aria-hidden={!open}
      inert={!open}
    >
      <header>
        <span>Camera movement</span>
        {controls.home &&
          control(controls.home, 'Return camera to home position', <Home size={16} />, 'is-home')}
      </header>
      <div className="camera-ptz-pad">
        <span />
        {control(controls.up, 'Tilt camera up', <ChevronUp size={21} />)}
        <span />
        {control(controls.left, 'Pan camera left', <ChevronLeft size={21} />)}
        {controls.stop ? (
          control(controls.stop, 'Stop camera movement', <CircleStop size={18} />, 'is-stop')
        ) : (
          <span className="camera-ptz-center" aria-hidden="true">
            <Move size={17} />
          </span>
        )}
        {control(controls.right, 'Pan camera right', <ChevronRight size={21} />)}
        <span />
        {control(controls.down, 'Tilt camera down', <ChevronDown size={21} />)}
        <span />
      </div>
      {(controls.zoomOut || controls.zoomIn) && (
        <div className="camera-ptz-zoom">
          {controls.zoomOut && control(controls.zoomOut, 'Zoom out', <ZoomOut size={17} />)}
          {controls.zoomIn && control(controls.zoomIn, 'Zoom in', <ZoomIn size={17} />)}
        </div>
      )}
    </section>
  ) : null;

  return (
    <div className="camera-ptz" ref={root}>
      <Button
        isIconOnly
        variant="ghost"
        className="camera-ptz-trigger"
        ref={trigger}
        aria-label="Camera movement controls"
        aria-expanded={open}
        aria-controls="camera-ptz-panel"
        onPress={() => setOpen((value) => !value)}
      >
        <Move size={19} />
      </Button>
      {panelNode && portalHost ? createPortal(panelNode, portalHost) : null}
    </div>
  );
}
