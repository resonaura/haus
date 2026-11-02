# @haus/homekit

Shared TypeScript ESM implementation for independent HomeKit camera accessories, HKSV prebuffer/fragment delivery and negotiated SRTP video, audio and return audio. Uses HAP-NodeJS as a protocol library; no Homebridge server.

The controller accepts injected inventory, persisted storage, activity, source leases and authenticated worker transport. It does not import Helper or NVR. The media worker accepts an already admitted source; it never discovers a camera or retains its original credentials. Local processing remains an explicit host policy.

Compile with the workspace build before running server apps. Runtime exports are compiled ESM under dist; TypeScript source declarations stay available to consumers. Limits, leases and privacy generation fences apply across both hosts. Hardware/LAN HomeKit acceptance is separate from fixture checks.
