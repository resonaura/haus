/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export function browserOffer() {
  return [
    'v=0',
    'o=- 1 1 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0 1',
    'a=msid-semantic: WMS *',
    ...['video', 'audio'].flatMap((kind, index) => [
      `m=${kind} 9 UDP/TLS/RTP/SAVPF ${index ? 111 : 96}`,
      'c=IN IP4 0.0.0.0',
      'a=ice-ufrag:fixture',
      'a=ice-pwd:fixturepassword012345678901',
      'a=fingerprint:sha-256 00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F',
      'a=setup:actpass',
      `a=mid:${index}`,
      'a=recvonly',
      'a=rtcp-mux',
      `a=rtpmap:${index ? 111 : 96} ${index ? 'opus/48000/2' : 'H264/90000'}`,
      ...(index ? [] : ['a=fmtp:96 packetization-mode=1']),
    ]),
    '',
  ].join('\r\n');
}
