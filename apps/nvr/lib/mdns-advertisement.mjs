/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

function privateIpv4(address) {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split(".").map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function nvrMdnsConfiguration(env = process.env) {
  if (!/^(1|true)$/i.test(env.HAUS_MDNS_ADVERTISE || "")) return undefined;
  const addressValue =
    typeof env.HAUS_MDNS_ADDRESS === "string" ? env.HAUS_MDNS_ADDRESS : "";
  const addresses = addressValue
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (
    addresses.length === 0 ||
    addresses.some((address) => !privateIpv4(address))
  )
    throw new Error(
      "Set HAUS_MDNS_ADDRESS to one or more private IPv4 addresses on the host network.",
    );
  return { addresses: [...new Set(addresses)] };
}

/** Advertise a non-secret pairing hint only; key exchange remains in the authenticated API. */
export async function startNvrMdnsAdvertisement({
  env = process.env,
  port = Number(env.PORT || 8098),
  ciao,
  getLocalAddresses = () =>
    new Set(
      Object.values(networkInterfaces())
        .flatMap((addresses) => addresses || [])
        .map(({ address }) => address),
    ),
} = {}) {
  const configuration = nvrMdnsConfiguration(env);
  if (!configuration) return undefined;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("The Haus NVR discovery port is invalid.");
  const localAddresses = getLocalAddresses();
  if (configuration.addresses.some((address) => !localAddresses.has(address)))
    throw new Error(
      "HAUS_MDNS_ADDRESS must match a private IPv4 address assigned to this host network.",
    );

  const library = ciao || (await import("@homebridge/ciao"));
  const getResponder = library.getResponder || library.default?.getResponder;
  if (typeof getResponder !== "function")
    throw new Error("The local discovery responder is unavailable.");
  const responder = getResponder();
  const service = responder.createService({
    name: "Haus NVR",
    type: "haus-nvr",
    port,
    txt: { protocol: "1" },
    restrictedAddresses: configuration.addresses,
    disabledIpv6: true,
  });
  try {
    await service.advertise();
  } catch (error) {
    try {
      await responder.shutdown();
    } catch {
      // Preserve the advertisement error; a failed goodbye must not hide it.
    }
    throw error;
  }

  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    await responder.shutdown();
  };
}
