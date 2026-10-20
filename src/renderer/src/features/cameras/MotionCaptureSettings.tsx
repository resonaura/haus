import { useRef, useState } from 'react';
import { Button, Label, Switch } from '@heroui/react';
import { Server, TriangleAlert } from 'lucide-react';
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
    <section className="camera-motion-settings" aria-label="Activity assist">
      <div className="camera-recording-policy" role="group" aria-label="Camera recording">
        <h3>Viewing & recording</h3>
        <div className="camera-recording-choices">
          <Button
            variant={camera?.enabled === false ? 'primary' : 'secondary'}
            aria-pressed={camera?.enabled === false}
            isDisabled={pending || !camera}
            onPress={() => void saveRecording(false)}
          >
            Stream only
          </Button>
          <Button
            variant={camera?.enabled ? 'primary' : 'secondary'}
            aria-pressed={camera?.enabled === true}
            isDisabled={pending || !camera}
            onPress={() => void saveRecording(true)}
          >
            Stream & record
          </Button>
        </div>
        <p>
          {!camera
            ? 'Reading your camera’s recording settings…'
            : camera.enabled
              ? 'Linked activity sensors save clips locally, including footage just before each event.'
              : 'Watch live video without saving new clips. Existing recordings stay available.'}
        </p>
      </div>
      <Switch
        isSelected={settings.enabled}
        isDisabled={pending || !camera?.enabled || !camera?.motionDetection}
        onChange={(enabled) => void save({ ...settings, enabled })}
      >
        <Switch.Content>
          <Label>Activity assist</Label>
        </Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
      <p>
        Supplements the camera’s motion sensor with local video analysis, or works without one.
        Includes pre-event footage. Off by default.
      </p>
      {placement && (
        <div
          className="camera-analysis-placement"
          data-warning={placement.warning || undefined}
          role="note"
        >
          {placement.warning ? (
            <TriangleAlert size={17} aria-hidden="true" />
          ) : (
            <Server size={17} aria-hidden="true" />
          )}
          <div>
            <strong>{placement.title}</strong>
            <p>{placement.description}</p>
          </div>
        </div>
      )}
      {settings.enabled && (
        <>
          <div className="camera-motion-modes" aria-label="What to record">
            <Button
              variant={settings.mode === 'objects' ? 'primary' : 'secondary'}
              aria-pressed={settings.mode === 'objects'}
              isDisabled={pending || !camera?.enabled}
              onPress={() => void save({ ...settings, mode: 'objects' })}
            >
              People, pets & vehicles
            </Button>
            <Button
              variant={settings.mode === 'motion' ? 'primary' : 'secondary'}
              aria-pressed={settings.mode === 'motion'}
              isDisabled={pending || !camera?.enabled}
              onPress={() => void save({ ...settings, mode: 'motion' })}
            >
              Sustained movement
            </Button>
          </div>
          <p>
            {settings.mode === 'objects'
              ? 'Recognizes common objects locally. For small animals, choose sustained movement.'
              : 'Filters brief noise and lighting changes without requiring object recognition.'}
          </p>
          <small>
            {camera?.motionStatus?.state === 'running'
              ? `Watching · ${camera.motionStatus.processor ?? 'Home server'}`
              : camera?.motionStatus?.blocked === 'capacity'
                ? 'Waiting for available processing capacity…'
                : camera?.motionStatus?.blocked === 'unsupported'
                  ? 'Waiting for a compatible NVR node…'
                  : 'Preparing local analysis…'}
          </small>
        </>
      )}
      {camera && !camera.motionDetection && (
        <small>Requires the latest Haus recording service.</small>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
