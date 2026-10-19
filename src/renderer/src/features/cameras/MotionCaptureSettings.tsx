import { useEffect, useRef, useState } from 'react';
import { Button, Label, Switch } from '@heroui/react';
import { message } from '../../hooks/useHaus';
type Settings = { enabled: boolean; mode: 'objects' | 'motion' };
interface Camera {
  id: string;
  aliases?: string[];
  motionDetection?: Settings;
  motionStatus?: { state: string; processor?: string };
}
export function MotionCaptureSettings({ cameraId }: { cameraId: string }) {
  const [camera, setCamera] = useState<Camera>();
  const [settings, setSettings] = useState<Settings>({ enabled: false, mode: 'objects' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    const read = async () => {
      if (saving.current) return;
      const expected = revision.current;
      try {
        const response = await window.hausNative?.helper<{ cameras: Camera[] }>({
          method: 'GET',
          path: '/api/cameras',
        });
        if (!active || expected !== revision.current) return;
        const next = response?.cameras.find(
          (item) => item.id === cameraId || item.aliases?.includes(cameraId),
        );
        setCamera(next);
        if (next?.motionDetection) setSettings(next.motionDetection);
      } catch {
        /* Preserve the device controls when the optional recording service is unavailable. */
      }
    };
    void read();
    const timer = setInterval(() => void read(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [cameraId]);
  const save = async (next: Settings) => {
    if (saving.current || !window.hausNative) return;
    saving.current = true;
    ++revision.current;
    const previous = settings;
    setSettings(next);
    setPending(true);
    setError('');
    try {
      await window.hausNative?.helper({
        method: 'PATCH',
        path: `/api/cameras/${cameraId}`,
        data: { motionDetection: next },
      });
    } catch (reason) {
      setSettings(previous);
      setError(message(reason));
    } finally {
      saving.current = false;
      setPending(false);
    }
  };
  return (
    <section className="camera-motion-settings" aria-label="Motion recording">
      <Switch
        isSelected={settings.enabled}
        isDisabled={pending || !camera?.motionDetection}
        onChange={(enabled) => void save({ ...settings, enabled })}
      >
        <Switch.Content>
          <Label>Detect motion</Label>
        </Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
      <p>Records activity with a pre-event buffer. Off until you enable it.</p>
      {settings.enabled && (
        <>
          <div className="camera-motion-modes" aria-label="What to record">
            <Button
              variant={settings.mode === 'objects' ? 'primary' : 'secondary'}
              aria-pressed={settings.mode === 'objects'}
              isDisabled={pending}
              onPress={() => void save({ ...settings, mode: 'objects' })}
            >
              People, pets & vehicles
            </Button>
            <Button
              variant={settings.mode === 'motion' ? 'primary' : 'secondary'}
              aria-pressed={settings.mode === 'motion'}
              isDisabled={pending}
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
              : 'Preparing local detection…'}
          </small>
        </>
      )}
      {!camera?.motionDetection && <small>Requires the latest Haus recording service.</small>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
