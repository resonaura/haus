import { TalkWaveform } from './TalkWaveform';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Mic, MicOff } from 'lucide-react';
export function CameraTalk({
  cameraId,
  demo,
  providerHint,
}: {
  cameraId: string;
  demo: boolean;
  providerHint?: 'eufy';
}) {
  const [available, setAvailable] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unavailableReason, setUnavailableReason] = useState('Checking camera talk support…');
  const stream = useRef<MediaStream | undefined>(undefined);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const stop = () => {
    generation.current++;
    clearTimeout(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recorder.current = undefined;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;
    setSpeaking(false);
    setBusy(false);
    void window.hausNative?.stopTalk().catch(() => {});
  };
  useEffect(() => {
    let active = true;
    setAvailable(false);
    if (!demo)
      void window.hausNative
        ?.helper<{ cameras: Array<{ id: string; aliases?: string[]; talkAvailable?: boolean }> }>({
          method: 'GET',
          path: '/api/cameras',
        })
        .then((result) => {
          if (active)
            setAvailable(
              result.cameras.some(
                (item) =>
                  (item.id === cameraId || item.aliases?.includes(cameraId)) &&
                  item.talkAvailable === true,
              ),
            );
          if (providerHint === 'eufy')
            void window.hausNative
              ?.helper<{ features?: { eufyTalkback?: boolean } }>({
                method: 'GET',
                path: '/api/status',
              })
              .then((status) => {
                if (active)
                  setUnavailableReason(
                    status.features?.eufyTalkback
                      ? 'Eufy Talk is unavailable. Check that eufy-security-ws is running.'
                      : 'Update the Haus recording service to enable Eufy Talk.',
                  );
              })
              .catch(() => {
                if (active) setUnavailableReason('Your recording service could not be reached.');
              });
        })
        .catch(() => {});
    const hidden = () => {
      if (document.visibilityState !== 'visible') stop();
    };
    document.addEventListener('visibilitychange', hidden);
    const blur = () => {
      if (stream.current) stop();
    };
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', blur);
      active = false;
      stop();
    };
  }, [cameraId, demo, providerHint]);
  const start = async () => {
    const api = window.hausNative;
    if (!api) return;
    setError('');
    setBusy(true);
    const current = ++generation.current;
    try {
      const input = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (current !== generation.current) {
        input.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = input;
      const media = new MediaRecorder(input, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 32000,
      });
      recorder.current = media;
      let queue = Promise.resolve();
      media.ondataavailable = (event) => {
        if (!event.data.size || current !== generation.current) return;
        queue = queue
          .then(async () => {
            if (current !== generation.current) return;
            await api.writeTalk(new Uint8Array(await event.data.arrayBuffer()));
          })
          .catch((reason) => {
            setError(reason.message);
            stop();
          });
      };
      // Start the streaming request and provide the WebM header before awaiting its response.
      const ready = api.startTalk(cameraId);
      media.start(100);
      await ready;
      if (current !== generation.current) return;
      setSpeaking(true);
      timer.current = setTimeout(stop, 54000);
    } catch (reason) {
      if (current !== generation.current) return;
      setError(reason instanceof Error ? reason.message : 'Microphone access is unavailable.');
      stop();
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  if (!available && (!providerHint || demo)) return null;
  return (
    <>
      <Button
        variant="ghost"
        aria-label={
          !available
            ? unavailableReason
            : busy
              ? 'Cancel talkback connection'
              : speaking
                ? 'Stop talking'
                : 'Talk through camera'
        }
        aria-pressed={speaking}
        onPress={() =>
          !available ? setError(unavailableReason) : speaking || busy ? stop() : void start()
        }
      >
        {speaking && stream.current ? (
          <TalkWaveform stream={stream.current} />
        ) : !available ? (
          <MicOff size={19} />
        ) : (
          <Mic size={19} />
        )}
      </Button>
      {error && (
        <span className="camera-talk-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
