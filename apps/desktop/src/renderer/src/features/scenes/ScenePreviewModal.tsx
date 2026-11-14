/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button, Modal } from '@heroui/react';
import { Eye, Info, Play } from 'lucide-react';
import type { HassEntity, Snapshot } from '../../model';
import { lightColor } from '../../model/light-color';

export interface SceneTargetEntry {
  id: string;
  setting: unknown;
}

export function ScenePreviewModal({
  scene,
  roomName,
  title,
  source,
  targets,
  snapshot,
  isHub,
  hiddenView,
  pending,
  canEdit,
  onClose,
  onEdit,
  onRestore,
  onRun,
}: {
  scene: HassEntity;
  roomName: string;
  title: string;
  source?: string;
  targets: SceneTargetEntry[];
  snapshot: Snapshot;
  isHub: boolean;
  hiddenView: boolean;
  pending: string;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onRestore: () => void;
  onRun: () => void;
}) {
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog scene-preview-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <span className="flow-eyebrow">SCENE DETAILS · {roomName}</span>
              <Modal.Heading>{title}</Modal.Heading>
              {source && <span className="scene-source-badge scene-source-inline">{source}</span>}
            </Modal.Header>
            <Modal.Body>
              <p className="flow-description">
                These are the targets reported by {isHub ? 'your Haus Hub' : 'Home Assistant'}.
                Previewing does not change your devices.
              </p>
              <div className="scene-target-list">
                {targets.map(({ id, setting }) => {
                  const current = snapshot.states.find((s) => s.entity_id === id);
                  const values =
                    setting && typeof setting === 'object'
                      ? (setting as Record<string, unknown>)
                      : undefined;
                  const attributes =
                    values?.attributes && typeof values.attributes === 'object'
                      ? (values.attributes as Record<string, unknown>)
                      : values;
                  const state = typeof setting === 'string' ? setting : values?.state;
                  const brightness = attributes?.brightness;
                  const color = attributes
                    ? lightColor({ entity_id: id, state: 'on', attributes, last_changed: '' })
                    : undefined;
                  return (
                    <div key={id}>
                      <span
                        className="scene-target-icon"
                        style={color ? { background: color } : undefined}
                      />
                      <span>
                        <strong>{String(current?.attributes.friendly_name ?? id)}</strong>
                        <small>
                          {state !== undefined ? String(state) : 'Target setting not supplied'}
                          {typeof brightness === 'number'
                            ? ` · ${Math.round(brightness / 2.55)}% brightness`
                            : ''}
                        </small>
                      </span>
                      <span className="scene-current">
                        Now: {current?.state ?? 'No live state'}
                      </span>
                    </div>
                  );
                })}
                {!targets.length && (
                  <p>
                    This integration does not expose scene targets.{' '}
                    {isHub
                      ? 'Edit the scene to add target accessories.'
                      : 'You can inspect the scene in Home Assistant.'}
                  </p>
                )}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" isDisabled={!canEdit} onPress={onEdit}>
                Edit scene <Info size={14} />
              </Button>
              {hiddenView ? (
                <Button onPress={onRestore}>
                  <Eye size={14} />
                  Restore to Haus
                </Button>
              ) : (
                <Button
                  isDisabled={Boolean(pending) || scene.state === 'unavailable'}
                  isPending={pending === scene.entity_id}
                  onPress={onRun}
                >
                  <Play size={14} />
                  Apply scene
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
