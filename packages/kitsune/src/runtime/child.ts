/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { createSdk } from '../sdk/managers.js';
import { FileStorage } from '../sdk/storage.js';
import { loadCommonJs } from './loader.js';
import type { Json, PluginDevice } from '../contracts.js';
import { selectStreams } from '../vendors/streams.js';

const [
  pluginId,
  entry,
  storageDirectory,
  endpointBase,
  ffmpegPath,
  publicEndpointBase,
  rootDescriptor,
] = process.argv.slice(2);
if (
  process.env.HAUS_KITSUNE_CHILD !== '1' ||
  !pluginId ||
  !entry ||
  !storageDirectory ||
  !endpointBase ||
  !ffmpegPath
)
  throw Error('kitsune_invalid_child');
const send = (message: unknown) => {
  if (process.connected) process.send?.(message);
};
const context = createSdk(pluginId, {
  storage: new FileStorage(storageDirectory),
  emit: (event) => send({ type: 'event', event }),
  diagnostic: (diagnostic) => send({ type: 'diagnostic', diagnostic }),
  ffmpegPath,
  endpointBase,
  publicEndpointBase: publicEndpointBase || undefined,
});
let root: PluginDevice;
try {
  await context.sdk.deviceManager.onDeviceDiscovered(JSON.parse(rootDescriptor));
  const plugin = await loadCommonJs(entry, context.sdk);
  root = plugin.root;
  context.registerRoot(root);
  process.on('message', async (input: unknown) => {
    const message = input as { id?: number; method?: string; deviceId?: string; args?: unknown[] };
    if (
      !Number.isSafeInteger(message?.id) ||
      typeof message.method !== 'string' ||
      !Array.isArray(message.args)
    )
      return;
    try {
      if (message.method === 'webhook') {
        const nativeId = message.args[0] as string | undefined;
        const record = context.records().find((record) => record.nativeId === nativeId);
        const handler =
          nativeId === undefined ? root : record && (await context.resolveDevice(record.id, root));
        if (!handler || !('onRequest' in handler) || typeof handler.onRequest !== 'function')
          throw Error('kitsune_webhook_unavailable');
        let response: { code: number; headers: Record<string, string>; body: Buffer } | undefined;
        await handler.onRequest(message.args[1], {
          send(
            body: string | Buffer,
            options?: { code?: number; headers?: Record<string, string> },
          ) {
            const bytes = Buffer.from(body ?? '');
            if (bytes.length > 6 * 1024 ** 2) throw Error('kitsune_response_limit');
            response = { code: options?.code ?? 200, headers: options?.headers ?? {}, body: bytes };
          },
        });
        send({
          type: 'result',
          id: message.id,
          result: response ?? { code: 204, headers: {}, body: Buffer.alloc(0) },
        });
        return;
      }
      const device = message.deviceId ? await context.resolveDevice(message.deviceId, root) : root;
      if (!device) throw Error('kitsune_device_unavailable');
      let result: unknown;
      if (message.method === 'records') result = context.records();
      else if (message.method === 'streams') {
        if (!device.getVideoStreamOptions) throw Error('kitsune_stream_options_unavailable');
        result = selectStreams(await device.getVideoStreamOptions());
      } else if (message.method === 'video') {
        if (!device.getVideoStream) throw Error('kitsune_video_unavailable');
        const media = await device.getVideoStream(
          message.args[0] as Record<string, Json> | undefined,
        );
        result = { mimeType: media.mimeType, data: await media.getData(), options: media.options };
      } else if (
        [
          'getSettings',
          'getCreateDeviceSettings',
          'createDevice',
          'putSetting',
          'onRequest',
          'releaseDevice',
          'refresh',
          'turnOn',
          'turnOff',
          'startIntercom',
          'stopIntercom',
        ].includes(message.method)
      ) {
        const callable = Reflect.get(device, message.method) as unknown;
        // Unknown fallback functions must not turn a missing physical command into success.
        if (!(message.method in device) || typeof callable !== 'function')
          throw Error('kitsune_capability_unavailable');
        result = await Reflect.apply(callable, device, message.args);
      } else throw Error('kitsune_method_not_allowed');
      send({ type: 'result', id: message.id, result });
    } catch {
      send({ type: 'result', id: message.id, error: 'kitsune_plugin_call_failed' });
    }
  });
  process.on('disconnect', () => {
    context.stop();
    plugin.close();
    process.exit(0);
  });
  send({ type: 'ready', records: context.records() });
} catch {
  send({ type: 'failed', error: 'kitsune_plugin_start_failed' });
  process.exitCode = 1;
}
