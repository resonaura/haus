/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';

export type TalkbackSourceCodec = 'opus' | 'aac_eld' | 'pcm_s16le';
export type TalkbackTargetCodec = 'pcmu' | 'pcma' | 'pcm_s16le' | 'opus';

export interface TalkbackTranscodeOptions {
  readonly sourceCodec?: TalkbackSourceCodec;
  readonly targetCodec?: TalkbackTargetCodec;
  readonly sourceSampleRate?: number; // e.g. 16000 or 24000
  readonly targetSampleRate?: number; // e.g. 8000
  readonly ffmpegPath?: string;
}

export class TalkbackAudioTranscoder {
  private process?: ChildProcess;
  private readonly inputStream = new PassThrough();
  private readonly outputStream = new PassThrough();
  private _active = false;

  constructor(private readonly options: TalkbackTranscodeOptions = {}) {}

  public get input(): PassThrough {
    return this.inputStream;
  }

  public get output(): PassThrough {
    return this.outputStream;
  }

  public get active(): boolean {
    return this._active;
  }

  public start(): void {
    if (this._active) return;

    const sourceCodec = this.options.sourceCodec ?? 'opus';
    const targetCodec = this.options.targetCodec ?? 'pcmu';
    const sourceRate = this.options.sourceSampleRate ?? 16000;
    const targetRate = this.options.targetSampleRate ?? 8000;
    const ffmpeg = this.options.ffmpegPath ?? 'ffmpeg';

    const args: string[] = [
      '-hide_banner',
      '-loglevel',
      'error',
      // Input configuration
      '-f',
      sourceCodec === 'opus' ? 'ogg' : 's16le',
      '-ar',
      sourceRate.toString(),
      '-ac',
      '1',
      '-i',
      'pipe:0',
      // Audio processing: resample to target rate and single channel
      '-af',
      `aresample=${targetRate}`,
      '-ac',
      '1',
      // Output format and codec
      '-f',
      targetCodec === 'pcmu' ? 'mulaw' : targetCodec === 'pcma' ? 'alaw' : 's16le',
      '-ar',
      targetRate.toString(),
      'pipe:1',
    ];

    try {
      this.process = spawn(ffmpeg, args, { stdio: ['pipe', 'pipe', 'ignore'] });
      this._active = true;

      this.inputStream.pipe(this.process.stdin!);
      this.process.stdout!.pipe(this.outputStream);

      this.process.on('close', () => {
        this._active = false;
        this.outputStream.end();
      });

      this.process.on('error', () => {
        this._active = false;
        this.stop();
      });
    } catch {
      this._active = false;
    }
  }

  public stop(): void {
    if (!this._active) return;
    this._active = false;

    try {
      this.inputStream.unpipe();
      this.process?.stdin?.destroy();
      this.process?.kill('SIGKILL');
    } catch {}

    this.process = undefined;
  }
}
