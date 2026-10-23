import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HassEntity } from '../../model';

interface EffectSlot {
  dependencies?: readonly unknown[];
  cleanup?: () => void;
}
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  pending: [] as (() => void)[],
  effects: [] as EffectSlot[],
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  const equal = (a?: readonly unknown[], b?: readonly unknown[]) =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((v, i) => Object.is(v, b[i]));
  return {
    ...react,
    useRef: (initial: unknown) => {
      const index = hooks.cursor++;
      return (hooks.slots[index] ??= { current: initial });
    },
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      hooks.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      const slot = hooks.slots[index] as { value: unknown };
      return [
        slot.value,
        (value: unknown) => {
          slot.value = typeof value === 'function' ? value(slot.value) : value;
        },
      ];
    },
    useCallback: (callback: unknown, dependencies: readonly unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as
        { value: unknown; dependencies: readonly unknown[] } | undefined;
      if (!previous || !equal(previous.dependencies, dependencies))
        hooks.slots[index] = { value: callback, dependencies };
      return (hooks.slots[index] as { value: unknown }).value;
    },
    useEffect: (effect: () => (() => void) | undefined, dependencies?: readonly unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as EffectSlot | undefined;
      if (previous && equal(previous.dependencies, dependencies)) return;
      const slot: EffectSlot = { dependencies };
      hooks.slots[index] = slot;
      hooks.effects.push(slot);
      hooks.pending.push(() => {
        previous?.cleanup?.();
        slot.cleanup = effect();
      });
    },
  };
});
vi.mock('react-dom', () => ({ flushSync: (callback: () => void) => callback() }));
vi.mock('../../hooks/useHaus', () => ({ message: (error: unknown) => String(error) }));
vi.mock('./useCameraPreheat', () => ({ useCameraPreheat: () => {} }));

const hls = vi.hoisted(() => ({ instances: [] as { destroy: ReturnType<typeof vi.fn> }[] }));
vi.mock('hls.js', () => ({
  default: class {
    static isSupported() {
      return true;
    }
    static Events = { MEDIA_DETACHING: 'detach', MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    static ErrorDetails = { MEDIA_SOURCE_REQUIRES_RESET: 'reset' };
    static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
    destroy = vi.fn();
    constructor() {
      hls.instances.push(this);
    }
    on() {}
    loadSource() {}
    attachMedia() {}
  },
}));

import { CameraPreview } from './CameraCard';
import { useCameraLiveStream } from './useCameraLiveStream';

function render(callback: () => unknown) {
  hooks.cursor = 0;
  callback();
  for (const effect of hooks.pending.splice(0)) effect();
}
class TestVideo extends EventTarget {
  callbacks = new Map<number, VideoFrameRequestCallback>();
  sequence = 0;
  muted = false;
  paused = false;
  currentTime = 0;
  videoWidth = 1920;
  readyState = 4;
  srcObject: unknown;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  removeAttribute = vi.fn();
  load = vi.fn();
  requestVideoFrameCallback(callback: VideoFrameRequestCallback) {
    this.callbacks.set(++this.sequence, callback);
    return this.sequence;
  }
  cancelVideoFrameCallback(id: number) {
    this.callbacks.delete(id);
  }
  frame(time: number) {
    this.currentTime = time;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks)
      callback(performance.now(), { mediaTime: time } as VideoFrameCallbackMetadata);
  }
}
let peers: { connectionState: string; onconnectionstatechange?: () => void }[];
let visibility: string;
let documentEvents: EventTarget;
let api: {
  cameraSnapshot: ReturnType<typeof vi.fn>;
  cameraLastSnapshot: ReturnType<typeof vi.fn>;
  onEvent: ReturnType<typeof vi.fn>;
  helper: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  hooks.slots = [];
  hooks.effects = [];
  hooks.pending = [];
  hls.instances = [];
  peers = [];
  visibility = 'visible';
  documentEvents = new EventTarget();
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibility;
    },
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
  });
  api = {
    cameraSnapshot: vi.fn(async () => 'data:image/jpeg;base64,frame'),
    cameraLastSnapshot: vi.fn(async () => undefined),
    onEvent: vi.fn(() => () => {}),
    helper: vi.fn(async () => ({ warm: false })),
    request: vi.fn(async (request: { type: string }) =>
      request.type === 'camera/capabilities'
        ? { frontend_stream_types: ['web_rtc'] }
        : request.type === 'camera/stream'
          ? { url: '/api/hls/live.m3u8' }
          : {},
    ),
    subscribe: vi.fn(async () => () => {}),
  };
  vi.stubGlobal('window', { hausNative: api });
  vi.stubGlobal('MediaStream', class {});
  vi.stubGlobal(
    'RTCPeerConnection',
    class {
      connectionState = 'connected';
      constructor() {
        peers.push(this);
      }
      addTransceiver() {}
      createOffer() {
        return Promise.resolve({ sdp: 'offer' });
      }
      setLocalDescription() {
        return Promise.resolve();
      }
      close() {}
    },
  );
});
afterEach(() => {
  for (const effect of hooks.effects) effect.cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function settle() {
  for (let i = 0; i < 16; i++) await Promise.resolve();
  await vi.dynamicImportSettled();
}
function live() {
  const rtc = new TestVideo();
  const relay = new TestVideo();
  const setStreamState = vi.fn();
  const setError = vi.fn();
  const setVideoReady = vi.fn();
  const setLiveTransport = vi.fn();
  render(() =>
    useCameraLiveStream({
      entityId: 'camera.garden',
      enabled: true,
      serverUrl: 'https://home.local',
      retry: 0,
      video: { current: null },
      rtcVideo: { current: rtc as unknown as HTMLVideoElement },
      relayVideo: { current: relay as unknown as HTMLVideoElement },
      mutedRef: { current: false },
      presentedRef: { current: true },
      freshStill: { current: false },
      displayedStill: { current: '' },
      retainFrame: vi.fn(),
      setLiveTransport,
      setVideoReady,
      setStreamState,
      setError,
      setStill: vi.fn(),
      setStillUpdatedAt: vi.fn(),
      setRetry: vi.fn(),
    }),
  );
  rtc.dispatchEvent(new Event('playing'));
  rtc.frame(1);
  return { rtc, relay, setStreamState, setError, setVideoReady, setLiveTransport };
}
function disconnected() {
  const peer = peers.at(-1)!;
  peer.connectionState = 'disconnected';
  peer.onconnectionstatechange?.();
}

describe('camera snapshot observation windows', () => {
  const entity = { entity_id: 'camera.garden', state: 'idle', attributes: {} } as HassEntity;
  it('does not count disabled preview time as a camera outage', async () => {
    const offline = vi.fn();
    const preview = (enabled: boolean) =>
      render(() => CameraPreview({ entity, demo: false, enabled, onOfflineChange: offline }));
    preview(true);
    await settle();
    preview(false);
    await vi.advanceTimersByTimeAsync(60000);
    let resolveSnapshot!: (image: string) => void;
    api.cameraSnapshot.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    offline.mockClear();
    preview(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(offline).not.toHaveBeenCalled();
    resolveSnapshot('data:image/jpeg;base64,new');
    await settle();
    expect(offline).not.toHaveBeenCalled();
  });
  it('suspends its deadline while hidden, then detects a sustained observed failure', async () => {
    const offline = vi.fn();
    render(() => CameraPreview({ entity, demo: false, onOfflineChange: offline }));
    await settle();
    visibility = 'hidden';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    offline.mockClear();
    await vi.advanceTimersByTimeAsync(60000);
    expect(offline).not.toHaveBeenCalled();
    api.cameraSnapshot.mockRejectedValue(new Error('camera unreachable'));
    visibility = 'visible';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(29999);
    expect(offline).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(offline).toHaveBeenLastCalledWith(true);
    api.cameraSnapshot.mockResolvedValue('data:image/jpeg;base64,recovered');
    await vi.advanceTimersByTimeAsync(10000);
    expect(offline).toHaveBeenLastCalledWith(false);
  });
});

describe('live replacement lifecycle', () => {
  it('keeps RTC selected and cancels a pending fallback when decoded frames continue without another playing event', async () => {
    const view = live();
    await settle();
    let resolveStream!: (value: { url: string }) => void;
    api.request.mockImplementation((request: { type: string }) =>
      request.type === 'camera/stream'
        ? new Promise((resolve) => {
            resolveStream = resolve;
          })
        : Promise.resolve({}),
    );
    disconnected();
    await settle();
    view.rtc.frame(1.1);
    resolveStream({ url: '/api/hls/live.m3u8' });
    await settle();
    expect(view.setLiveTransport).toHaveBeenLastCalledWith('rtc');
    expect(view.setStreamState).toHaveBeenLastCalledWith('Live · WebRTC');
    expect(view.setError).toHaveBeenLastCalledWith('');
    expect(hls.instances).toHaveLength(0);
  });
  it('does not replace recently advancing RTC with a Snapshot error when HLS fails', async () => {
    const view = live();
    await settle();
    api.request.mockRejectedValue(new Error('HLS unavailable'));
    disconnected();
    await settle();
    expect(view.setStreamState).toHaveBeenLastCalledWith('Live · WebRTC');
    expect(view.setError).toHaveBeenLastCalledWith('');
    expect(view.setVideoReady).toHaveBeenLastCalledWith(true);
  });
  it('does not let the old RTC cross-fade timeout destroy a newly staged HLS decoder', async () => {
    const view = live();
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    disconnected();
    await settle();
    expect(hls.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(hls.instances[0].destroy).not.toHaveBeenCalled();
    view.relay.dispatchEvent(new Event('playing'));
    view.relay.frame(0.3);
    expect(view.setLiveTransport).toHaveBeenLastCalledWith('hls');
    expect(view.setVideoReady).toHaveBeenLastCalledWith(true);
  });
  it('still reports a real decoder stall when its repair also fails', async () => {
    const view = live();
    await settle();
    api.request.mockRejectedValue(new Error('HLS unavailable'));
    await vi.advanceTimersByTimeAsync(4000);
    await settle();
    expect(view.setStreamState).toHaveBeenLastCalledWith('Snapshot');
    expect(view.setError).toHaveBeenLastCalledWith(
      'Live video is unavailable. Showing the latest snapshot.',
    );
    expect(view.setVideoReady).toHaveBeenLastCalledWith(false);
    view.rtc.frame(1.1);
    expect(view.setStreamState).toHaveBeenLastCalledWith('Live · WebRTC');
    expect(view.setError).toHaveBeenLastCalledWith('');
    expect(view.setVideoReady).toHaveBeenLastCalledWith(true);
  });
});
