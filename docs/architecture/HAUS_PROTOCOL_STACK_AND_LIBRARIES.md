# Haus Protocol Stack, Hardware Rules, and Responsibility Matrix

## 1. Matter Specification and Stack Architecture

- **Primary TypeScript Stack**: `@matter/main` (`matter.js`). Haus embeds `matter.js` natively inside the Hub for both `MatterControllerAdapter` (controlling physical Matter devices) and `MatterAggregatorAdapter` (exposing Haus devices to Apple Home, Google Home, Amazon Alexa).
- **Reference/Native Stack**: `connectedhomeip` (Project CHIP C++ implementation) for embedded builds and hardware certification.
- **Excluded Stacks**: `python-matter-server` is explicitly excluded from Haus architecture.
- **Robot Vacuum Cleaner (RVC)**:
  - Primary Apple export: Matter RVC endpoint (device type `0x0074`), never fake HAP Switches/Fans.
  - Clusters: `RVC Run Mode` (`0x0054`), `RVC Clean Mode` (`0x0055`), `RVC Operational State` (`0x0061`), `Service Area`.

### 1.1 Multi-Admin Enhanced Commissioning Method Sequence

1. Active CASE session on current fabric.
2. User triggers multi-admin pairing in Haus client.
3. Hub issues `OpenCommissioningWindow` on `AdministratorCommissioning` cluster.
4. Generates temporary 12-bit discriminator (`0..4095`) and temporary 27-bit passcode.
5. Emits manual 11-digit or 21-digit pairing code (`XXXXX-XXXXXX`) and QR payload (`MT:...`).
6. Target commissioner performs BLE/mDNS discovery -> PASE handshake -> Fail-safe timer armed.
7. Device Attestation Certificate (DAC) verification -> Certificate Signing Request (CSR).
8. Target commissioner installs Root CA and Node Operational Certificate (NOC).
9. Fabric entry inserted -> Access Control List (ACL) installed.
10. Operational discovery via mDNS -> CASE session established on new fabric -> `CommissioningComplete`.
11. Commissioning window automatically closed.

### 1.2 Matter Adapter Contracts

```ts
export interface MatterControllerAdapter {
  commissionNode(params: MatterCommissioningParams): Promise<MatterNode>;
  unpairNode(nodeId: MatterNodeId): Promise<void>;
  listNodes(): Promise<readonly MatterNode[]>;
  readAttribute(subscription: MatterAttributeSubscription): Promise<unknown>;
  writeAttribute(subscription: MatterAttributeSubscription, value: unknown): Promise<void>;
  invokeCommand(
    nodeId: MatterNodeId,
    endpointId: number,
    clusterId: number,
    commandId: number,
    args?: unknown,
  ): Promise<unknown>;
  openCommissioningWindow(request: MatterShareRequest): Promise<MatterSharePayload>;
}

export interface MatterAggregatorAdapter {
  registerBridgedDevice(device: unknown): Promise<number>;
  unregisterBridgedDevice(endpointId: number): Promise<void>;
  updateAttribute(
    endpointId: number,
    clusterId: number,
    attributeId: number,
    value: unknown,
  ): Promise<void>;
  startAggregator(): Promise<void>;
  stopAggregator(): Promise<void>;
}
```

## 2. Thread Network and Border Router Architecture

- **Engine**: OpenThread (`ot-br-posix`, `otbr-agent`) communicating over Spinel protocol with Radio Co-Processor (RCP) firmware on dedicated `wpan0` interface.
- **Routing**: Bi-directional IPv6 routing between Thread mesh and Ethernet/Wi-Fi backbone, on-mesh prefixes, SLAAC/RA, Service Registration Protocol (SRP), mDNS discovery, Thread Radio Encapsulation Link (TREL), NAT64.
- **Credentials**: Encrypted `ThreadCredentialVault` managing raw Active Operational Dataset (Network Key, PSKc, PAN ID, Channel, Mesh-Local Prefix).
  - `storeDataset(dataset, vaultKey)`: AES-256-GCM envelope (`iv`, `ciphertext`, `authTag`).
  - `exportRawActiveOperationalDataset(dataset)`: Serializes canonical Thread TLVs.
  - `importRawActiveOperationalDataset(rawTlv)`: Deserializes standard Thread TLV buffer.
- **Client APIs**: Apple `ThreadNetwork.framework` (requires entitlement `com.apple.developer.networking.thread` and user consent) and Google Play Services `ThreadNetworkClient`. Thread credentials never transit external cloud services.

## 3. Zigbee Architecture and Dual-Radio Rule

- **Engine**: `zigbee-herdsman` and `zigbee-herdsman-converters`. Does not require MQTT internally when running in Haus Hub.
- **Coordinator Adapters**:
  - `zstack`: Texas Instruments CC2652 / CC1352
  - `ember`: Silicon Labs EZRadioPRO / EFR32
  - `deconz`: ConBee / RaspBee
  - `zigate`: ZiGate
  - `zboss`: DSR ZBOSS
  - `zoh`: ZOH
  - `ezsp`: Deprecated legacy Silicon Labs driver
- **Firmware Lifecycle**: Automatic coordinator backup (`nvram` / `open_pan`) before firmware flashing; safe restore on replacement.
- **Dual-Radio Rule**: Baseline Haus appliance hardware MUST feature separate physical radios for Zigbee (802.15.4) and Thread (802.15.4). Single-radio multiprotocol (dynamic multiprotocol) is forbidden for production stability.

## 4. Media Engine and Streaming Architecture

- **Engines**: `go2rtc` and `MediaMTX` as primary media brokers; `FFmpeg` (`@haus/media`) for probe and hardware transcode fallback.
- **Zero-Transcode Passthrough**: When camera source codec (e.g. H.264 Baseline/Main or H.265) matches client capabilities, packets are relayed directly without decoding or re-encoding (`canZeroTranscodeRelay`).
- **MediaBroker Interface**:
  - `ingestRtsp(streamId, url)` & `publishRtsp(streamId)`
  - `startWebRtcSession(config)` (WHIP/WHEP)
  - `startSrtpSession(streamId, config)` (HAP camera live streaming)
  - `getHksvPrebuffer(streamId)` (circular fMP4 ring buffer)
  - `streamFmp4(streamId)` & `streamCmaf(streamId)`
  - `extractSnapshot(streamId)` & `sendTalkbackAudio(streamId, stream)`
  - `startTranscodeFallback(streamId, config)` (hardware accelerated fallback)

## 5. Responsibility Split Matrix

| Capability / Task                | Execution Tier | Rationale                                            |
| -------------------------------- | -------------- | ---------------------------------------------------- |
| BLE Commissioning Scan           | CLIENT         | Uses phone/tablet native Bluetooth hardware          |
| Matter QR Code Scan              | CLIENT         | Uses mobile camera framework                         |
| HomeKit Setup Code Scan          | CLIENT         | Uses mobile camera framework                         |
| Apple Thread Credential Import   | CLIENT         | Bound to iOS `ThreadNetwork.framework`               |
| Android Thread Credential Import | CLIENT         | Bound to Google Play Services `ThreadNetworkClient`  |
| OS Permission Dialogs            | CLIENT         | Handled by native OS user prompt                     |
| HomeKit Framework Access         | CLIENT         | Local iOS HomeKit API access                         |
| Matter Controller Fabric         | HUB            | Owns operational fabric, nodes, and keys             |
| CASE Session Management          | HUB            | Maintains persistent cryptographic sessions          |
| OpenCommissioningWindow          | HUB            | Authoritative node administrator action              |
| OpenThread Border Router (OTBR)  | HUB            | Controls local `wpan0` RCP radio hardware            |
| Thread Dataset Persistence       | HUB            | Secures credentials in host credential vault         |
| Zigbee Coordinator               | HUB            | Directly controls local 802.15.4 serial coordinator  |
| mDNS / DNS-SD Advertisement      | HUB            | Advertises Hub services on local subnet              |
| HAP Server / Accessory Publisher | HUB            | Terminates incoming HAP pairings and events          |
| HAP Controller                   | HUB            | Pairs and controls upstream HomeKit accessories      |
| RTSP / WebRTC Server             | HUB            | Ingests camera streams and packages live feeds       |
| HKSV Prebuffer                   | HUB            | Maintains ring buffer of fMP4 fragments              |
| Plugin Sandbox                   | HUB            | Isolated runtime for Kitsune community extensions    |
| Credential Vault                 | HUB            | AES-256-GCM hardware/software encrypted store        |
| Audit Log                        | HUB            | Append-only ledger of security and automation events |
| Firmware Flashing                | HUB            | Physical serial flashing of radio co-processors      |
| Interactive UI Rendering         | CLIENT         | React / React Native renderer                        |
| Automation Execution             | HUB            | Sub-millisecond rule execution beside event loop     |
