/*
 * Haus — A thoughtful home.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

// Host-side `_haus-hub._tcp` advertiser for Hubs whose container network cannot
// reach the LAN (e.g. Docker inside WSL2 NAT). Needs `@homebridge/ciao` resolvable
// from the script directory. Discovery is only a hint; pairing authenticates the Hub.
import { getResponder } from '@homebridge/ciao';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
const address = required('HAUS_MDNS_ADDRESS');
const port = Number(process.env.PORT ?? 8790);
if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) || !Number.isInteger(port))
  throw new Error('HAUS_MDNS_ADDRESS must be a private IPv4 address and PORT a number.');

const responder = getResponder();
const service = responder.createService({
  name: process.env.HAUS_HUB_NAME ?? 'Haus Hub',
  type: 'haus-hub',
  port,
  txt: {
    protocol: '1',
    hubId: required('HAUS_HUB_ID'),
    homeId: process.env.HAUS_HOME_ID ?? 'home-default',
  },
  restrictedAddresses: [address],
  disabledIpv6: true,
});
await service.advertise();
console.log(`Advertising _haus-hub._tcp on ${address}:${port}`);

const stop = () => void responder.shutdown().finally(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
