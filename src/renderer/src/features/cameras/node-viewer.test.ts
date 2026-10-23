import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeNodeViewer, gatherViewerIce, negotiateNodeViewer } from './node-viewer';
import type { HausNative } from '../../../../shared/native';
const camera = 'camera.fixture';
const viewer = '26c1f67d-9ce3-4099-8f1a-42c6826be001';
class Peer extends EventTarget {
  iceGatheringState = 'new';
  localDescription: { sdp: string } | null = null;
  createOffer = vi.fn(async () => ({
    type: 'offer',
    sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96',
  }));
  setLocalDescription = vi.fn(async (value: { sdp: string }) => {
    this.localDescription = value;
  });
  setRemoteDescription = vi.fn(async () => {});
  addIceCandidate = vi.fn(async () => {});
  complete() {
    this.iceGatheringState = 'complete';
    this.localDescription!.sdp += '\r\na=candidate:1 1 udp 1 192.0.2.1 9 typ host\r\n';
    this.dispatchEvent(new Event('icegatheringstatechange'));
  }
}
const rtc = (peer: Peer) => peer as unknown as RTCPeerConnection;
const api = (helper: ReturnType<typeof vi.fn>) => ({ helper }) as Pick<HausNative, 'helper'>;
async function microtasks() {
  for (let n = 0; n < 10; n++) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());
describe('NVR viewer signaling', () => {
  it('sends a gathered offer only to the helper and applies the NVR answer/candidates', async () => {
    const peer = new Peer();
    const candidate = { candidate: 'candidate:2 1 udp 1 192.0.2.2 8555 typ host', sdpMid: '0' };
    const helper = vi.fn(async (_request: { data: { offer: string } }) => ({
      answer: { type: 'answer', sdp: 'v=0\r\n' },
      candidates: [candidate],
    }));
    const controller = new AbortController();
    const task = negotiateNodeViewer(api(helper), rtc(peer), camera, viewer, controller.signal);
    await microtasks();
    expect(helper).not.toHaveBeenCalled();
    peer.complete();
    await task;
    expect(helper).toHaveBeenCalledExactlyOnceWith({
      method: 'POST',
      path: `/api/cameras/${camera}/viewer`,
      data: { viewerId: viewer, offer: peer.localDescription!.sdp },
    });
    expect(helper.mock.calls[0][0].data.offer).toContain('typ host');
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'v=0\r\n' });
    expect(peer.addIceCandidate).toHaveBeenCalledWith(candidate);
  });
  it('releases a viewer accepted after dismissal and never attaches its answer', async () => {
    const peer = new Peer();
    peer.iceGatheringState = 'complete';
    let resolve!: (value: unknown) => void;
    const helper = vi.fn((request: { path: string }) =>
      request.path.endsWith('/close')
        ? Promise.resolve({ closed: true })
        : new Promise((done) => {
            resolve = done;
          }),
    );
    const controller = new AbortController();
    const task = negotiateNodeViewer(api(helper), rtc(peer), camera, viewer, controller.signal);
    await microtasks();
    controller.abort();
    await closeNodeViewer(api(helper), camera, viewer);
    resolve({ answer: { type: 'answer', sdp: 'v=0\r\n' } });
    await task;
    expect(peer.setRemoteDescription).not.toHaveBeenCalled();
    expect(helper.mock.calls.filter(([request]) => request.path.endsWith('/close'))).toHaveLength(
      2,
    );
  });
  it('cleans up a rejected answer without leaving an orphan consumer', async () => {
    const peer = new Peer();
    peer.iceGatheringState = 'complete';
    peer.setRemoteDescription.mockRejectedValueOnce(new Error('decoder rejected SDP'));
    const helper = vi.fn(async () => ({ answer: { type: 'answer', sdp: 'v=0\r\n' } }));
    await expect(
      negotiateNodeViewer(api(helper), rtc(peer), camera, viewer, new AbortController().signal),
    ).rejects.toThrow('decoder rejected');
    expect(helper).toHaveBeenLastCalledWith({
      method: 'POST',
      path: `/api/cameras/${camera}/viewer/close`,
      data: { viewerId: viewer },
    });
  });
  it('releases a possibly accepted remote viewer when the signaling response is lost', async () => {
    const peer = new Peer();
    peer.iceGatheringState = 'complete';
    const helper = vi.fn(async (request: { path: string }) => {
      if (!request.path.endsWith('/close')) throw new Error('response lost');
      return { closed: true };
    });
    await expect(
      negotiateNodeViewer(api(helper), rtc(peer), camera, viewer, new AbortController().signal),
    ).rejects.toThrow('response lost');
    expect(helper).toHaveBeenLastCalledWith({
      method: 'POST',
      path: `/api/cameras/${camera}/viewer/close`,
      data: { viewerId: viewer },
    });
  });
  it('cancels ICE gathering on dismissal without creating a remote session or keeping a timer', async () => {
    vi.useFakeTimers();
    const peer = new Peer();
    const helper = vi.fn();
    const controller = new AbortController();
    const task = negotiateNodeViewer(api(helper), rtc(peer), camera, viewer, controller.signal);
    const rejected = expect(task).rejects.toThrow('closed');
    await microtasks();
    controller.abort();
    await rejected;
    expect(helper).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds local candidate collection when an adapter never reports completion', async () => {
    vi.useFakeTimers();
    const peer = new Peer();
    const task = gatherViewerIce(rtc(peer), new AbortController().signal, 2500);
    await vi.advanceTimersByTimeAsync(2500);
    await task;
    expect(vi.getTimerCount()).toBe(0);
  });
});
