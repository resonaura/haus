export interface ServerSshProfile {
  serverId: string;
  host: string;
  port: number;
  username: string;
  environment: 'native' | 'wsl';
  auth: 'password' | 'agent';
  hasPassword: boolean;
}
export interface ServerSshInput extends Omit<ServerSshProfile, 'hasPassword'> {
  password?: string;
  rememberPassword?: boolean;
}
export type ServerTerminalEvent =
  | { sessionId: string; type: 'data'; data: string; bytes: number }
  | {
      sessionId: string;
      type: 'status';
      state: 'connecting' | 'connected' | 'disconnected';
      message?: string;
    }
  | { sessionId: string; type: 'host-key'; fingerprint: string; changed: boolean }
  | { sessionId: string; type: 'exit'; code: number | null };
export interface ServerTerminalOpen {
  sessionId: string;
  profile: ServerSshInput;
  cols: number;
  rows: number;
  trustFingerprint?: string;
}
