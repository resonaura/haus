/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export interface RecoveryOptions {
  kit: string;
  node: string;
  action: 'backups' | 'recordings' | 'backup' | 'recording';
  cursor?: string;
  digest?: string;
  recording?: string;
  output?: string;
}
export const digestPattern = /^[a-f0-9]{64}$/;
export const recordingPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

export function recoveryOptions(args: string[]): RecoveryOptions {
  const flags = new Set(['--list', '--list-recordings']);
  const values = new Set(['--kit', '--node', '--digest', '--recording', '--output', '--cursor']);
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (parsed.has(name) || (!flags.has(name) && !values.has(name)))
      throw Error('invalid_recovery_arguments');
    const value = flags.has(name) ? '' : args[++index];
    if (value === undefined || (values.has(name) && (!value || value.startsWith('--'))))
      throw Error('invalid_recovery_arguments');
    parsed.set(name, value);
  }
  const kit = parsed.get('--kit'),
    node = parsed.get('--node');
  const actions = ['--list', '--list-recordings', '--digest', '--recording'].filter((name) =>
    parsed.has(name),
  );
  if (!kit || !node || actions.length !== 1) throw Error('invalid_recovery_arguments');
  const action =
    actions[0] === '--list'
      ? 'backups'
      : actions[0] === '--list-recordings'
        ? 'recordings'
        : actions[0] === '--digest'
          ? 'backup'
          : 'recording';
  const output = parsed.get('--output'),
    cursor = parsed.get('--cursor'),
    digest = parsed.get('--digest'),
    recording = parsed.get('--recording');
  if (
    (action === 'backup' || action === 'recording') !== Boolean(output) ||
    (cursor !== undefined && (action !== 'recordings' || cursor.length > 4096)) ||
    (digest !== undefined && !digestPattern.test(digest)) ||
    (recording !== undefined && !recordingPattern.test(recording))
  )
    throw Error('invalid_recovery_arguments');
  return { kit, node, action, cursor, digest, recording, output };
}
