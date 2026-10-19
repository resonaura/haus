import { useEffect, useRef } from 'react';

/** Mirrors scrypted-tuya's symmetric frequency bars, without React updates per frame. */
export function TalkWaveform({ stream }: { stream: MediaStream }) {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const audio = new AudioContext();
    const source = audio.createMediaStreamSource(stream);
    const high = audio.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 300;
    const low = audio.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 3400;
    const analyser = audio.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(high);
    high.connect(low);
    low.connect(analyser);
    // Keep the analyser graph pulled without playing the microphone locally.
    const silent = audio.createGain();
    silent.gain.value = 0;
    analyser.connect(silent);
    silent.connect(audio.destination);
    void audio.resume().catch(() => {});
    const values = new Uint8Array(analyser.frequencyBinCount);
    const bars = [...(host.current?.children ?? [])] as HTMLElement[];
    let frame = 0,
      previous = 0;
    const tick = (now: number) => {
      if (now - previous >= 33) {
        previous = now;
        analyser.getByteFrequencyData(values);
        for (let i = 0; i < bars.length; i++) {
          const weight = Math.max(0.15, 1 - (Math.abs(i - 4) / 4) * 0.7);
          const index = Math.min(
            values.length - 1,
            Math.floor(1 + (i * (values.length - 2)) / bars.length),
          );
          bars[i].style.height = `${3 + 15 * Math.pow((values[index] / 255) * weight, 1.3)}px`;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      high.disconnect();
      low.disconnect();
      analyser.disconnect();
      silent.disconnect();
      void audio.close().catch(() => {});
    };
  }, [stream]);
  return (
    <span className="camera-talk-waveform" ref={host} aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}
