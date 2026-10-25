import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { ShieldCheck } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import type { ServerSshInput, ServerTerminalEvent } from '../../../../shared/terminal';
import type { ServerRoom } from './server-rooms';

export function ServerSshAddDialog({
  rooms,
  onClose,
  onAdded,
}: {
  rooms: ServerRoom[];
  onClose: () => void;
  onAdded: (serverId: string, name: string, areaId: string) => void | Promise<void>;
}) {
  const [profile, setProfile] = useState<ServerSshInput>(() => ({
    serverId: `ssh:${crypto.randomUUID()}`,
    host: '',
    port: 22,
    username: '',
    environment: 'native',
    auth: 'password',
    rememberPassword: true,
  }));
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState(rooms[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [challenge, setChallenge] = useState<{ fingerprint: string; changed: boolean }>();
  const sessionId = useRef<string>();
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const nameRef = useRef(name);
  nameRef.current = name;
  const areaIdRef = useRef(areaId);
  areaIdRef.current = areaId;
  const onAddedRef = useRef(onAdded);
  onAddedRef.current = onAdded;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const native = window.hausNative;
    if (!native?.onServerTerminal) return;
    return native.onServerTerminal((event: ServerTerminalEvent) => {
      if (event.sessionId !== sessionId.current) return;
      if (event.type === 'host-key') {
        setChallenge({ fingerprint: event.fingerprint, changed: event.changed });
        setBusy(false);
      } else if (event.type === 'status' && event.state === 'connected') {
        const current = profileRef.current;
        const displayName = nameRef.current.trim() || `${current.username}@${current.host}`;
        setBusy(false);
        setProfile((value) => ({ ...value, password: undefined }));
        void native
          .serverTerminalClose(event.sessionId)
          .then(() => onAddedRef.current(current.serverId, displayName, areaIdRef.current))
          .then(() => onCloseRef.current())
          .catch((reason) =>
            setError(reason instanceof Error ? reason.message : 'The SSH server could not be added.'),
          );
      } else if (event.type === 'status' && event.state === 'disconnected') {
        setBusy(false);
        setError(event.message || 'Could not connect to this SSH server.');
      }
    });
  }, []);

  useEffect(
    () => () => {
      if (sessionId.current) void window.hausNative?.serverTerminalClose(sessionId.current);
    },
    [],
  );

  const connect = async (trustFingerprint?: string) => {
    const native = window.hausNative;
    if (!native) {
      setError('SSH connections are available in the Haus desktop app.');
      return;
    }
    setError('');
    setChallenge(undefined);
    setBusy(true);
    const id = sessionId.current ?? crypto.randomUUID();
    sessionId.current = id;
    try {
      await native.serverTerminalOpen({
        sessionId: id,
        profile: profileRef.current,
        cols: 80,
        rows: 24,
        ...(trustFingerprint ? { trustFingerprint } : {}),
      });
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : 'Could not start the SSH connection.');
    }
  };

  const change = (patch: Partial<ServerSshInput>) =>
    setProfile((current) => ({ ...current, ...patch }));

  return (
    <Dialog
      title="Add an SSH server"
      className="server-pair-dialog server-ssh-add-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="registry-help">
        Connect over SSH to add this machine to your home. Credentials are kept in the system’s
        secure storage. Resource details appear only when the server reports them.
      </p>
      <div className="server-terminal-settings">
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Home server"
            maxLength={100}
            disabled={busy}
          />
        </label>
        <label>
          Host
          <input
            value={profile.host}
            onChange={(event) => change({ host: event.target.value })}
            placeholder="192.168.1.20 or server.home"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={busy}
          />
        </label>
        <label className="server-terminal-port">
          Port
          <input
            type="number"
            min="1"
            max="65535"
            value={profile.port}
            onChange={(event) => change({ port: Number(event.target.value) })}
            required
            disabled={busy}
          />
        </label>
        <label>
          Username
          <input
            value={profile.username}
            onChange={(event) => change({ username: event.target.value })}
            autoComplete="username"
            required
            disabled={busy}
          />
        </label>
        <label>
          Authentication
          <select
            value={profile.auth}
            onChange={(event) => change({ auth: event.target.value as 'password' | 'agent' })}
            disabled={busy}
          >
            <option value="password">Password</option>
            <option value="agent">System SSH agent</option>
          </select>
        </label>
        {profile.auth === 'password' && (
          <label>
            Password
            <input
              type="password"
              value={profile.password ?? ''}
              onChange={(event) => change({ password: event.target.value || undefined })}
              autoComplete="new-password"
              required
              disabled={busy}
            />
          </label>
        )}
        {rooms.length > 0 && (
          <label>
            Room
            <select value={areaId} onChange={(event) => setAreaId(event.target.value)} disabled={busy}>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="server-terminal-remember">
          <input
            type="checkbox"
            checked={profile.rememberPassword}
            onChange={(event) => change({ rememberPassword: event.target.checked })}
            disabled={busy}
          />
          Save credentials in secure storage
        </label>
      </div>
      {challenge && (
        <div className="server-terminal-host-key">
          <ShieldCheck size={22} />
          <div>
            <strong>{challenge.changed ? 'The server’s SSH key changed' : 'Verify this server'}</strong>
            <p>{challenge.fingerprint}</p>
            <small>
              Compare this fingerprint with the server administrator before trusting it.
            </small>
          </div>
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => void connect(challenge.fingerprint)}
          >
            Trust and connect
          </Button>
        </div>
      )}
      {error && (
        <p className="server-terminal-error" role="alert">
          {error}
        </p>
      )}
      {!challenge && (
        <div className="registry-dialog-actions">
          <Button variant="ghost" isDisabled={busy} onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            isPending={busy}
            isDisabled={!profile.host || !profile.username || (profile.auth === 'password' && !profile.password)}
            onPress={() => void connect()}
          >
            Connect and add
          </Button>
        </div>
      )}
      <p className="server-scope-note">
        A plain SSH connection gives access to the terminal. Haus Helper is required for live
        processor, memory, disk and service measurements.
      </p>
    </Dialog>
  );
}
