/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useState, type ComponentProps } from 'react';
import { Text } from '@haus/ui';
import { ConnectionsPage as LegacyConnections } from '../connections/ConnectionsPage';
import { FeatureLoading } from '../../components/ui/Deferred';
import { InstalledApps } from './installed';

export function ConnectionsPage(props: ComponentProps<typeof LegacyConnections>) {
  const [hub, setHub] = useState<boolean>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (props.kind !== 'addons' || props.demo) return;
    let active = true;
    if (!window.hausNative) {
      setError('Open Haus desktop to manage your Apps.');
      return;
    }
    const load = () => {
      void window.hausNative
        ?.getSession()
        .then((session) => {
          if (active) {
            setHub(session?.kind === 'haus-hub');
            setError('');
          }
        })
        .catch(() => {
          if (active) setError('Could not read your Hub connection.');
        });
    };
    load();
    const unsubscribe = window.hausNative?.onEvent((event) => {
      if (event.type === 'connection' && event.status === 'connected') load();
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [props.kind, props.demo]);
  if (props.kind !== 'addons' || props.demo || hub === false)
    return <LegacyConnections {...props} />;
  if (error)
    return (
      <Text semantic="p" className="form-error" role="alert">
        {error}
      </Text>
    );
  if (hub === undefined) return <FeatureLoading />;
  return <InstalledApps admin={props.snapshot.user.is_admin} />;
}
