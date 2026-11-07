/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { runMediaProcess } from '../../src/pipeline/transcode.js';

export async function playbackSource(output: string): Promise<void> {
  await runMediaProcess('ffmpeg', [
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x90:rate=20',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=16000',
    '-t',
    '3',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-threads',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    output,
  ]);
}
export async function decodePlayback(input: string): Promise<void> {
  await runMediaProcess('ffmpeg', [
    '-hide_banner',
    '-v',
    'error',
    '-xerror',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-fps_mode',
    'passthrough',
    '-enc_time_base:v',
    '1:90000',
    '-f',
    'null',
    '-',
  ]);
}
