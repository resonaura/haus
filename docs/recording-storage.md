# Recording storage investigation

Measured 2026-10-28; reviewed 2026-10-31. Existing originals and recording policies were not changed.

## Where the space goes

The complete Miku file inventory separates 12,652,316,463 bytes of originals (2,160 files), 28,136,443,660 bytes of prepared playback copies (2,140 files), 9,836,309,201 bytes of Home Assistant backups and 54,412,609 bytes of configuration backups. These categories are not a measurement of one week of camera footage.

Two bounded existing-clip comparisons identify a concrete source of amplification:

| Camera      | Video duration | Original bytes | Prepared bytes | Prepared/original |
| ----------- | -------------: | -------------: | -------------: | ----------------: |
| Guinea Pigs |       40.364 s |      6,206,314 |     14,687,699 |             2.37× |
| Outdoor     |       29.850 s |      6,416,783 |     28,838,066 |             4.49× |

Both originals contain H.264 Main Level 5 video and real AAC audio. The compatibility encoder currently uses H.264 `veryfast`, CRF 20 and forced 20 fps. Re-encoding an already compressed source at a fixed quality can therefore increase storage substantially. Two clips establish the mechanism, not its distribution across the archive.

## Decoder comparison

An isolated Electron process played both original files over an HTTP range server and reported VideoToolboxVideoDecoder with platform decoding enabled. It received native 2304×1296 and 2688×1520 frames and decoded AAC audio. Three non-keyframes at separated timestamps from each original were compared at native resolution with FFmpeg reference frames: Guinea Pigs matched RGBA exactly; Outdoor mean absolute channel error was 1.03–1.05/255, with minimum PSNR 43.93 dB and global SSIM 0.99974. The latter comparison includes decoder/color-conversion differences; global SSIM alone is not a perceptual-quality guarantee.

This establishes a bounded macOS decoder result only. It does not establish Windows/Android decoder compatibility, sustained playback, all archive provenance or seek behavior. Guinea Pigs' maximum measured keyframe interval was 1.267 s; Outdoor's was 3.015 s, exceeding the existing 2.5 s admission limit. The original trust/admission guard remains in force.

Proof data remains outside Git in private local diagnostic directories. No footage, credentials, camera URLs or native decoder dumps are included in the repository.

## Next implementation gates

1. Treat prepared media as reconstructible cache with explicit per-node controls, active-reader pins and independent accounting. Retain immutable original/backup authority and explain reclaimable bytes to the user.
2. Admit lossless original/remux playback only for proven source profiles and client decoder capabilities, with bounded seek checks and the existing repair fallback. A codec name or good packet timestamps alone cannot establish compatibility.
3. Compare candidate encoders on the same source samples before selecting defaults. Measure output size, frame detail, sound, seek/start time, encode time and peak CPU/RAM, including weak-node refusal. Evaluate hardware-supported codecs against actual client support.
4. Keep old originals intact. Do not automatically change codec, quality, retention or camera transport based on this investigation. A storage reduction is not yet shipped by this assessment.
