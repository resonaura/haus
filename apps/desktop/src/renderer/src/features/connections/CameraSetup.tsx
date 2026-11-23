import { cameraIntegrationDomains as cameraDomains } from '@haus/kitsune/vendors';
/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo, useState } from 'react';
import { Box as UiBox, HausButton as Button, HausModalOverlay as Modal, Text } from '@haus/ui';
import { Box, Camera, ChevronRight, Link, Radar } from 'lucide-react';
import type { Snapshot } from '../../model';
import { IntegrationFlow } from './IntegrationFlow';
import { ManualCameraSetup } from './ManualCameraSetup';

export function CameraSetup({
  snapshot,
  onClose,
  onDone,
  onApps,
}: {
  snapshot: Snapshot;
  onClose: () => void;
  onDone: () => void;
  onApps: () => void;
}) {
  const [path, setPath] = useState<'integration' | 'manual' | 'existing'>();
  const domains = useMemo(
    () =>
      new Set([
        ...cameraDomains,
        ...snapshot.entities
          .filter((entry) => entry.entity_id.startsWith('camera.'))
          .flatMap((entry) => (entry.platform ? [entry.platform] : [])),
      ]),
    [snapshot.entities],
  );
  if (path === 'integration')
    return (
      <IntegrationFlow
        target={{}}
        domains={domains}
        snapshot={snapshot}
        onClose={onClose}
        onDone={onDone}
      />
    );
  if (path === 'manual' || path === 'existing')
    return (
      <ManualCameraSetup
        snapshot={snapshot}
        existing={path === 'existing'}
        onClose={onClose}
        onDone={onDone}
      />
    );
  const count = snapshot.entities.filter(
    (entry) =>
      entry.entity_id.startsWith('camera.') &&
      !entry.disabled_by &&
      !entry.entity_id.endsWith('_internal'),
  ).length;
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog camera-setup-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Text className="flow-eyebrow">ADD CAMERA</Text>
              <Modal.Heading>A little peace of mind.</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Text semantic="p" className="flow-description">
                Start with your camera’s brand. Haus uses its supported connection, discovery and
                sign-in steps.
              </Text>
              <UiBox className="setup-paths">
                <Button variant="secondary" className="setup-path" onPress={onApps}>
                  <Box />
                  <Text>
                    <Text semantic="strong">Manage camera Apps</Text>
                    <Text semantic="small">Connect accessories from an installed App</Text>
                  </Text>
                  <ChevronRight />
                </Button>
                <Button
                  variant="secondary"
                  className="setup-path"
                  onPress={() => setPath('integration')}
                >
                  <Radar />
                  <Text>
                    <Text semantic="strong">Find a camera</Text>
                    <Text semantic="small">Discovered cameras and supported brands</Text>
                  </Text>
                  <ChevronRight />
                </Button>
                {!!count && (
                  <Button
                    variant="secondary"
                    className="setup-path"
                    onPress={() => setPath('existing')}
                  >
                    <Camera />
                    <Text>
                      <Text semantic="strong">Use an existing camera</Text>
                      <Text semantic="small">Choose from {count} cameras already in your home</Text>
                    </Text>
                    <ChevronRight />
                  </Button>
                )}
                <Button
                  variant="secondary"
                  className="setup-path"
                  onPress={() => setPath('manual')}
                >
                  <Link />
                  <Text>
                    <Text semantic="strong">Connect with an address</Text>
                    <Text semantic="small">RTSP, a snapshot URL, or existing source entities</Text>
                  </Text>
                  <ChevronRight />
                </Button>
              </UiBox>
              <Text semantic="p" className="management-hint">
                New cameras start in Stream only. You can enable local event recording in camera
                settings.
              </Text>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                Cancel
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
