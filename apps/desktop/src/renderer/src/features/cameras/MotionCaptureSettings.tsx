/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useRef, useState } from 'react';
import { Box, HausButton, HausSwitch, Heading, Text } from '@haus/ui';
import { Activity, Server, TriangleAlert } from 'lucide-react';
import { message } from '../../hooks/useHaus';
import { activityPlacementNotice } from './activity-assist-status';
import { cameraSettings } from '../../ha/camera-settings';
import { useCameraSettings } from '../../hooks/useCameraSettings';
type Settings = { enabled: boolean; mode: 'objects' | 'motion' };
export function MotionCaptureSettings({ cameraId }: { cameraId: string }) {
  const camera = useCameraSettings(cameraId);
  const settings: Settings = camera?.motionDetection ?? { enabled: false, mode: 'objects' };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const placement = camera?.motionStatus && activityPlacementNotice(camera.motionStatus);
  const activity = camera?.activity;
  const recordingEnabled = camera?.enabled === true;
  const save = async (next: Settings) => {
    if (saving.current || !window.hausNative) return;
    saving.current = true;
    setPending(true);
    setError('');
    try {
      await cameraSettings.update(cameraId, { motionDetection: next });
    } catch (reason) {
      setError(message(reason));
    } finally {
      saving.current = false;
      setPending(false);
    }
  };
  const saveRecording = async (enabled: boolean) => {
    if (saving.current || !camera || !window.hausNative) return;
    saving.current = true;
    setPending(true);
    setError('');
    try {
      await cameraSettings.update(cameraId, { enabled });
    } catch (reason) {
      setError(message(reason));
    } finally {
      saving.current = false;
      setPending(false);
    }
  };
  return (
    <Box semantic="section" className="camera-motion-settings" ariaLabel="Activity assist">
      <Box className="camera-recording-policy" role="group" ariaLabel="Camera recording">
        <Heading level={3}>Viewing & recording</Heading>
        <Box className="camera-recording-choices">
          <HausButton
            variant={recordingEnabled ? 'secondary' : 'primary'}
            aria-pressed={!recordingEnabled}
            isDisabled={pending || !camera}
            onPress={() => void saveRecording(false)}
          >
            Stream only
          </HausButton>
          <HausButton
            variant={recordingEnabled ? 'primary' : 'secondary'}
            aria-pressed={recordingEnabled}
            isDisabled={pending || !camera}
            onPress={() => void saveRecording(true)}
          >
            Stream & record
          </HausButton>
        </Box>
        <Text semantic="p">
          {!camera
            ? 'Reading your camera’s recording settings…'
            : recordingEnabled
              ? 'Linked activity sensors save clips locally, including footage just before each event.'
              : 'Watch live video without saving new clips. Existing recordings stay available.'}
        </Text>
      </Box>
      <HausSwitch
        isSelected={settings.enabled}
        isDisabled={pending || !camera || !camera.motionDetection}
        label="Activity assist"
        onChange={(enabled) => void save({ ...settings, enabled })}
      />
      <Text semantic="p">
        Validates motion with local video analysis, or works without a built-in sensor. Includes
        pre-event footage. Off by default.
      </Text>
      {activity && (
        <Box className="camera-analysis-placement" role="status" ariaLabel="Camera activity">
          <Activity size={17} aria-hidden="true" />
          <Box>
            <Text semantic="strong">
              {!activity.available
                ? 'Activity unavailable'
                : activity.active
                  ? 'Activity detected'
                  : 'No activity'}
            </Text>
            <Text semantic="p">
              {activity.source === 'assisted'
                ? 'Built-in events and local analysis share one activity sensor.'
                : activity.source === 'native_fallback'
                  ? 'Using the built-in sensor while local analysis is unavailable.'
                  : activity.source === 'analysis_unavailable'
                    ? 'Waiting for fresh analysis; this is not a clear reading.'
                    : 'Using the linked camera sensors.'}
            </Text>
          </Box>
        </Box>
      )}
      {placement && (
        <Box
          className="camera-analysis-placement"
          dataAttrs={{ 'data-warning': placement.warning || undefined }}
          role="note"
        >
          {placement.warning ? (
            <TriangleAlert size={17} aria-hidden="true" />
          ) : (
            <Server size={17} aria-hidden="true" />
          )}
          <Box>
            <Text semantic="strong">{placement.title}</Text>
            <Text semantic="p">{placement.description}</Text>
          </Box>
        </Box>
      )}
      {settings.enabled && (
        <>
          <Box className="camera-motion-modes" ariaLabel="What to record">
            <HausButton
              variant={settings.mode === 'objects' ? 'primary' : 'secondary'}
              aria-pressed={settings.mode === 'objects'}
              isDisabled={pending || !camera}
              onPress={() => void save({ ...settings, mode: 'objects' })}
            >
              People, pets & vehicles
            </HausButton>
            <HausButton
              variant={settings.mode === 'motion' ? 'primary' : 'secondary'}
              aria-pressed={settings.mode === 'motion'}
              isDisabled={pending || !camera}
              onPress={() => void save({ ...settings, mode: 'motion' })}
            >
              Sustained movement
            </HausButton>
          </Box>
          <Text semantic="p">
            {settings.mode === 'objects'
              ? 'Confirms people, common pets and vehicles across frames instead of recording every pixel change. Very small animals may need sustained movement.'
              : 'Filters brief noise, lighting changes and small swaying motion. Moving foliage can still cause false positives in this mode.'}
          </Text>
          <Text semantic="small">
            {camera?.motionStatus?.state === 'running' && camera.motionStatus.fresh !== false
              ? `Watching · ${camera.motionStatus.processor ?? 'Home server'}`
              : camera?.motionStatus?.blocked === 'capacity'
                ? 'Waiting for available processing capacity…'
                : camera?.motionStatus?.blocked === 'unsupported'
                  ? 'Waiting for a compatible NVR node…'
                  : 'Preparing local analysis…'}
          </Text>
        </>
      )}
      {camera && !camera.motionDetection && (
        <Text semantic="small">Requires the latest Haus recording service.</Text>
      )}
      {error && (
        <Text semantic="p" role="alert">
          {error}
        </Text>
      )}
    </Box>
  );
}
