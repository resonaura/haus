/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useRef, useState } from 'react';
import { Description, Label, Switch } from '@heroui/react';
import { Lightbulb, Moon } from 'lucide-react';
import { cameraSettings } from '../../ha/camera-settings';
import { useCameraSettings } from '../../hooks/useCameraSettings';
import { serverRequest } from '../servers/server-api';

export function CameraOperatingSettings({ cameraId }: { cameraId: string }) {
  const camera = useCameraSettings(cameraId);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState('');
  const hasControls = Boolean(camera?.operating && Object.keys(camera.operating).length);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!hasControls || camera?.homekit?.enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void cameraSettings.refresh(true).catch(() => {});
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasControls, camera?.homekit?.enabled]);
  const write = async (control: 'indicator' | 'nightVision', entityId: string, value: boolean) => {
    setPending(control);
    setError('');
    try {
      await serverRequest('POST', `/api/cameras/${cameraId}/operating`, {
        control,
        entityId,
        value,
      });
      await cameraSettings.refresh(true);
    } catch (reason) {
      if (mounted.current) {
        setError(
          reason instanceof Error ? reason.message : 'Could not change this camera setting.',
        );
        void cameraSettings.refresh(true).catch(() => {});
      }
    } finally {
      if (mounted.current) setPending(undefined);
    }
  };
  if (!camera?.operating || !Object.keys(camera.operating).length) return null;
  return (
    <section className="camera-operating-settings" aria-label="Camera lights">
      {(['indicator', 'nightVision'] as const).map((control) => {
        const state = camera.operating?.[control];
        if (!state) return null;
        const Icon = control === 'indicator' ? Lightbulb : Moon;
        return (
          <div key={control}>
            <Switch
              isSelected={state.value}
              isDisabled={!state.available || !!pending}
              onChange={(value) => void write(control, state.id, value)}
            >
              <Switch.Content>
                <Label>
                  <Icon size={17} aria-hidden="true" />
                  {control === 'indicator' ? 'Status light' : 'Automatic night vision'}
                </Label>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            <Description>
              {control === 'indicator'
                ? 'The camera’s status indicator. Separate from its spotlight.'
                : 'Let the camera use infrared when it is dark. This does not force infrared on.'}
            </Description>
          </div>
        );
      })}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
