import type { HausNative } from '../../../../shared/native';

type SignalingApi = Pick<HausNative, 'helper'>;
export interface NodeViewerAnswer {
  answer: RTCSessionDescriptionInit;
  candidates?: RTCIceCandidateInit[];
}

/** LAN candidates are gathered locally; HA/STUN never produces the media session. */
export function gatherViewerIce(peer: RTCPeerConnection, signal: AbortSignal, timeoutMs = 2500) {
  if (signal.aborted) return Promise.reject(new Error('Viewer closed.'));
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', changed);
      signal.removeEventListener('abort', aborted);
      if (signal.aborted) reject(new Error('Viewer closed.'));
      else resolve();
    };
    const changed = () => {
      if (peer.iceGatheringState === 'complete') finish();
    };
    const aborted = () => finish();
    const timer = setTimeout(finish, timeoutMs);
    peer.addEventListener('icegatheringstatechange', changed);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

export async function closeNodeViewer(api: SignalingApi, camera: string, viewerId: string) {
  await api
    .helper({
      method: 'POST',
      path: `/api/cameras/${camera}/viewer/close`,
      data: { viewerId },
    })
    .catch(() => {});
}

/** A late signaling response must release its remote consumer even after dismissal. */
export async function negotiateNodeViewer(
  api: SignalingApi,
  peer: RTCPeerConnection,
  camera: string,
  viewerId: string,
  signal: AbortSignal,
) {
  const offer = await peer.createOffer();
  if (signal.aborted) return;
  await peer.setLocalDescription(offer);
  await gatherViewerIce(peer, signal);
  if (signal.aborted) return;
  const sdp = peer.localDescription?.sdp;
  if (!sdp) throw new Error('Camera negotiation did not produce an offer.');
  try {
    const result = await api.helper<NodeViewerAnswer>({
      method: 'POST',
      path: `/api/cameras/${camera}/viewer`,
      data: { viewerId, offer: sdp },
    });
    if (signal.aborted) {
      await closeNodeViewer(api, camera, viewerId);
      return;
    }
    if (
      result?.answer?.type !== 'answer' ||
      typeof result.answer.sdp !== 'string' ||
      !result.answer.sdp.startsWith('v=0') ||
      result.answer.sdp.length > 65536 ||
      (result.candidates !== undefined &&
        (!Array.isArray(result.candidates) || result.candidates.length > 32))
    )
      throw new Error('The camera server returned an invalid answer.');
    await peer.setRemoteDescription(result.answer);
    for (const candidate of result.candidates ?? []) {
      if (signal.aborted) return;
      await peer.addIceCandidate(candidate);
    }
  } catch (error) {
    await closeNodeViewer(api, camera, viewerId);
    throw error;
  }
}
