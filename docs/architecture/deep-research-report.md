# Haus: Universal Smart-Home Device Model, HomeKit/Matter Passthrough, and Multi-Protocol Architecture

## Protocol baseline and architectural conclusions

This blueprint targets the protocol state visible on **November 5, 2026**. Home Assistant Core is on the 2026.11 development line; HAP-NodeJS’s generated HomeKit metadata is currently version `V=889`; Matter has progressed through Matter 1.6 and 1.6.1; Home Assistant’s Matter backend has moved away from the former Python/CHIP-based server toward a `matter.js`-based server; and Apple Home now officially recognizes Matter robot-vacuum devices. citeturn525304search0turn744416view0turn747323search0turn747323search1turn725562search7turn408123search8

The central architectural recommendation is to make **Haus itself protocol-neutral**. Home Assistant entities, HAP services, Matter endpoints/clusters, Zigbee exposes, and vendor-specific properties should all terminate in a canonical:

```text
Physical / Remote Endpoint
        │
        ▼
Haus Device
  ├── Service
  │     ├── Characteristic
  │     ├── Characteristic
  │     └── Characteristic
  ├── Service
  │     └── Characteristic
  └── SourceBinding[]
```

A Haus `Device` is an identity and lifecycle boundary. A `Service` is a coherent capability or sub-device. A `Characteristic` is the smallest typed observable/controllable state unit. Protocol adapters never become the canonical model; they translate into and out of it.

This distinction is critical for HomeKit passthrough. Haus cannot be a cryptographically transparent TCP proxy for HAP because Pair Setup, Pair Verify, session keys, accessory/controller identities, event subscriptions, timed writes, and HDS sessions terminate separately on each side. What Haus *can* provide is a **lossless application-semantic proxy**: retain every source service UUID, characteristic UUID, IID/AID relationship, metadata field, unknown TLV payload, permission, and event value, then regenerate an equivalent outbound accessory graph. HAP-NodeJS explicitly models service UUIDs, characteristic UUIDs, linked-service IIDs, permissions, value constraints, and controller-specific services in ways suitable for this architecture. citeturn523657search6turn523657search10turn523657search4

The other major architectural conclusion is that the user's proposed “Cameras, Televisions, Smart Locks, and Routers MUST all be standalone” rule is **too strong as a protocol statement**. HAP-NodeJS supports bridged cameras, and Homebridge routinely bridges locks and many other accessory categories. Homebridge deliberately publishes cameras and most televisions separately, while Scrypted defaults cameras to standalone accessory mode for performance and behavior reasons. Therefore Haus should distinguish **HAP legality** from **Apple-feature fidelity**: ordinary locks can be bridged; camera/HKSV, television/remote-control, HomeKey/NFC-access, and router/security-networking profiles should preferentially receive dedicated HAP servers where that preserves native Apple behavior or isolates latency-sensitive traffic. citeturn845297search2turn845297search5turn104367search5

### Canonical Haus schema

A practical TypeScript representation is:

```ts
type HausId = string;
type Protocol =
  | "home-assistant"
  | "hap-ip"
  | "hap-ble"
  | "hap-thread"
  | "matter"
  | "zigbee"
  | "thread"
  | "vendor"
  | "virtual";

interface HausDevice {
  id: HausId;
  stableKey: string;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  hardwareVersion?: string;

  sourceRefs: SourceDeviceRef[];
  services: HausService[];
  relationships: DeviceRelationship[];

  areaId?: string;
  availability: Availability;
  diagnostics: Record<string, HausValue>;

  // Protocol metadata is preserved, not normalized away.
  opaqueMetadata: Record<string, unknown>;
}

interface HausService {
  id: HausId;
  stableKey: string;
  type: HausServiceType;
  subtype?: string;
  name?: string;

  characteristics: HausCharacteristic[];
  linkedServiceIds: HausId[];

  sourceRefs: SourceServiceRef[];
  opaqueMetadata: Record<string, unknown>;
}

interface HausCharacteristic<T = HausValue> {
  id: HausId;
  stableKey: string;
  type: HausCharacteristicType;
  value: T | null;

  readable: boolean;
  writable: boolean;
  notifiable: boolean;

  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  validValues?: Array<string | number | boolean>;

  sourceRefs: SourceCharacteristicRef[];
  metadata: Record<string, unknown>;
}

type HausValue =
  | boolean
  | number
  | string
  | Uint8Array
  | null
  | HausValue[]
  | { [key: string]: HausValue };
```

Protocol-specific identity must survive round trips. For HAP, store `aid`, service `iid`, characteristic `iid`, type UUID, format, unit, permissions, min/max/minStep, maxLen/maxDataLen, valid-values, valid-values-range, linked-service references, event state, and the raw value/TLV8. For Matter, store node ID, fabric index, endpoint, device types, cluster IDs, attribute IDs, command/event IDs, data versions, feature maps, quality flags, fabric-scoped markers, nullable/optional markers, and raw TLV values. For Home Assistant, store config-entry ID, device-registry ID, entity-registry ID, entity ID, domain, device class, supported-feature mask, state, attributes, capabilities, options, and disabled/hidden metadata.

The canonical generic characteristic family should be first-class rather than an escape hatch:

```ts
type GenericCharacteristic =
  | GenericBoolean
  | GenericInt
  | GenericFloat
  | GenericEnum
  | GenericString
  | GenericAction
  | GenericJSONBlob;

interface GenericBoolean {
  kind: "generic.boolean";
  value: boolean | null;
}

interface GenericInt {
  kind: "generic.int";
  value: number | null;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

interface GenericFloat {
  kind: "generic.float";
  value: number | null;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

interface GenericEnum {
  kind: "generic.enum";
  value: string | number | null;
  values: Array<{
    value: string | number;
    label?: string;
  }>;
}

interface GenericString {
  kind: "generic.string";
  value: string | null;
  maxLength?: number;
  multiline?: boolean;
}

interface GenericAction {
  kind: "generic.action";
  actionId: string;
  arguments?: HausCharacteristic[];
}

interface GenericJSONBlob {
  kind: "generic.json";
  value: HausValue;
  schemaUri?: string;
}
```

No inbound information should ever be dropped merely because HomeKit or Matter has no native presentation for it.

## Home Assistant exhaustive entity inventory

Home Assistant’s generated `EntityPlatform` registry is the most authoritative way to answer “what counts as an entity platform” because it is generated from Core. The current development tree explicitly contains the following platforms. citeturn875860view0

1. `ai_task`
2. `air_quality`
3. `alarm_control_panel`
4. `assist_satellite`
5. `binary_sensor`
6. `button`
7. `calendar`
8. `camera`
9. `climate`
10. `conversation`
11. `cover`
12. `date`
13. `datetime`
14. `device_tracker`
15. `event`
16. `fan`
17. `geo_location`
18. `humidifier`
19. `image`
20. `image_processing`
21. `infrared`
22. `lawn_mower`
23. `light`
24. `lock`
25. `media_player`
26. `notify`
27. `number`
28. `radio_frequency`
29. `remote`
30. `scene`
31. `select`
32. `sensor`
33. `siren`
34. `stt`
35. `switch`
36. `text`
37. `time`
38. `todo`
39. `tts`
40. `update`
41. `vacuum`
42. `valve`
43. `wake_word`
44. `water_heater`
45. `weather`

That list is intentionally based on the generated Core platform registry rather than a hand-curated consumer list. It consequently includes infrastructure-oriented platforms such as `air_quality`, `image_processing`, `infrared`, and `radio_frequency` that are easy to omit from UI-oriented smart-home inventories. citeturn875860view0

### Device-class registries

The current `BinarySensorDeviceClass` values are individually: `battery`, `battery_charging`, `carbon_monoxide`, `cold`, `connectivity`, `door`, `garage_door`, `gas`, `glass_break`, `heat`, `light`, `lock`, `moisture`, `motion`, `moving`, `occupancy`, `opening`, `plug`, `power`, `presence`, `problem`, `running`, `safety`, `smoke`, `sound`, `tamper`, `update`, `vibration`, and `window`. citeturn232659view1

The current `CoverDeviceClass` values are individually: `awning`, `blind`, `curtain`, `damper`, `door`, `garage`, `gate`, `shade`, `shutter`, and `window`. citeturn232659view2

The current `MediaPlayerDeviceClass` values are individually: `tv`, `speaker`, `receiver`, and `projector`. citeturn232659view3

The current `SwitchDeviceClass` values are individually: `outlet` and `switch`. citeturn225208search2

The current `ButtonDeviceClass` values are individually: `identify`, `restart`, and `update`. citeturn464786search0

The current `EventDeviceClass` values are individually: `doorbell`, `button`, and `motion`. Button-event types defined by Core include `press_start`, `press_end`, `long_press_start`, `long_press_end`, `multi_press_ongoing`, and `multi_press_end`; the doorbell event type is `ring`. citeturn756841view1

`SensorDeviceClass` contains the non-numeric classes `date`, `enum`, `timestamp`, and `uptime`, plus the following numeric classes individually: `absolute_humidity`, `apparent_power`, `aqi`, `area`, `atmospheric_pressure`, `battery`, `blood_glucose_concentration`, `carbon_monoxide`, `carbon_dioxide`, `conductivity`, `current`, `data_rate`, `data_size`, `distance`, `duration`, `energy`, `energy_distance`, `energy_storage`, `frequency`, `gas`, `humidity`, `illuminance`, `irradiance`, `moisture`, `monetary`, `nitrogen_dioxide`, `nitrogen_monoxide`, `nitrous_oxide`, `ozone`, `ph`, `pm1`, `pm10`, `pm25`, `pm4`, `power_factor`, `power`, `precipitation`, `precipitation_intensity`, `pressure`, `radon`, `reactive_energy`, `reactive_power`, `signal_strength`, `sound_pressure`, `speed`, `sulphur_dioxide`, `temperature`, `temperature_delta`, `volatile_organic_compounds`, `volatile_organic_compounds_parts`, `voltage`, `volume`, `volume_storage`, `volume_flow_rate`, `water`, `weight`, `wind_direction`, and `wind_speed`. citeturn232659view0turn992825view0turn992825view1

`NumberDeviceClass` uses the numeric sensor-class vocabulary and therefore contains: `absolute_humidity`, `apparent_power`, `aqi`, `area`, `atmospheric_pressure`, `battery`, `blood_glucose_concentration`, `carbon_monoxide`, `carbon_dioxide`, `conductivity`, `current`, `data_rate`, `data_size`, `distance`, `duration`, `energy`, `energy_distance`, `energy_storage`, `frequency`, `gas`, `humidity`, `illuminance`, `irradiance`, `moisture`, `monetary`, `nitrogen_dioxide`, `nitrogen_monoxide`, `nitrous_oxide`, `ozone`, `ph`, `pm1`, `pm10`, `pm25`, `pm4`, `power_factor`, `power`, `precipitation`, `precipitation_intensity`, `pressure`, `radon`, `reactive_energy`, `reactive_power`, `signal_strength`, `sound_pressure`, `speed`, `sulphur_dioxide`, `temperature`, `temperature_delta`, `volatile_organic_compounds`, `volatile_organic_compounds_parts`, `voltage`, `volume`, `volume_storage`, `volume_flow_rate`, `water`, `weight`, `wind_direction`, and `wind_speed`. citeturn756841view2

### Complex feature masks and state contracts

For `alarm_control_panel`, the feature mask is `ARM_HOME=1`, `ARM_AWAY=2`, `ARM_NIGHT=4`, `TRIGGER=8`, `ARM_CUSTOM_BYPASS=16`, and `ARM_VACATION=32`. States are `disarmed`, `armed_home`, `armed_away`, `armed_night`, `armed_vacation`, `armed_custom_bypass`, `pending`, `arming`, `disarming`, and `triggered`. Core exposes `code_format`, `changed_by`, and `code_arm_required`, with code formats `text` and `number`, and defines services corresponding to arm-away, arm-home, arm-night, arm-vacation, custom-bypass, disarm, and trigger. citeturn762471view0

Haus should model that as a richer internal state machine rather than collapsing it immediately into HomeKit's four target states. A suitable internal enum is:

```text
DISARMED
ARMING_HOME
ARMING_AWAY
ARMING_NIGHT
ARMING_VACATION
ARMING_CUSTOM
ARMED_HOME
ARMED_AWAY
ARMED_NIGHT
ARMED_VACATION
ARMED_CUSTOM
PENDING
DISARMING
TRIGGERED
FAULT
UNAVAILABLE
```

Apple `SecuritySystemTargetState` has only Stay, Away, Night, and Disarm, while `SecuritySystemCurrentState` adds AlarmTriggered. Vacation and custom-bypass therefore need explicit policy mappings or Haus-only generic characteristics rather than silent equivalence. HAP’s current-state values are StayArm `0`, AwayArm `1`, NightArm `2`, Disarmed `3`, AlarmTriggered `4`; target values are StayArm `0`, AwayArm `1`, NightArm `2`, Disarm `3`. citeturn292116view3

For `vacuum`, Core's current activity values are `cleaning`, `docked`, `idle`, `paused`, `returning`, and `error`. Feature bits are `TURN_ON=1` and `TURN_OFF=2` as deprecated legacy features, `PAUSE=4`, `STOP=8`, `RETURN_HOME=16`, `FAN_SPEED=32`, legacy `STATUS=128`, `SEND_COMMAND=256`, `LOCATE=512`, `CLEAN_SPOT=1024`, `MAP=2048`, `STATE=4096`, `START=8192`, and `CLEAN_AREA=16384`. Core also exposes fan-speed lists and clean-area IDs. citeturn762471view1

Matter provides a materially better exporter for robotic vacuums than legacy HAP. The Matter RVC device type is `0x0074`; Matter 1.2 requires RVC Run Mode and RVC Operational State, optionally implements RVC Clean Mode, and later operational-state revisions include pause/resume and GoHome semantics. Apple now lists robot vacuum cleaners among Matter-certified categories compatible with Apple Home. citeturn408123search11turn408123search12turn408123search13turn408123search8

For `climate`, `HVACMode` values are `off`, `heat`, `cool`, `heat_cool`, `auto`, `dry`, and `fan_only`. Core defines canonical presets including `none`, `eco`, `away`, `boost`, `comfort`, `home`, `sleep`, and `activity`; HVAC actions include `cooling`, `defrosting`, `drying`, `fan`, `heating`, `idle`, `off`, and `preheating`. Current feature bits are `TARGET_TEMPERATURE=1`, `TARGET_TEMPERATURE_RANGE=2`, `TARGET_HUMIDITY=4`, `FAN_MODE=8`, `PRESET_MODE=16`, `SWING_MODE=32`, `TURN_OFF=128`, `TURN_ON=256`, and `SWING_HORIZONTAL_MODE=512`. Core capability/state fields include HVAC modes; minimum, maximum and step temperatures; current and target temperatures; target high/low temperatures; current and target humidity; fan modes; preset modes; swing modes; horizontal-swing modes; HVAC action; and temperature unit. citeturn762471view2

Notably, older Home Assistant APIs exposed auxiliary-heat concepts, but the current feature enum cited above does not define a current `AUX_HEAT` feature bit. Haus should therefore ingest auxiliary heat if an integration still publishes it as an attribute/service but must not manufacture a current Core feature constant that no longer exists. citeturn762471view2

For `media_player`, feature bits are `PAUSE=1`, `SEEK=2`, `VOLUME_SET=4`, `VOLUME_MUTE=8`, `PREVIOUS_TRACK=16`, `NEXT_TRACK=32`, `TURN_ON=128`, `TURN_OFF=256`, `PLAY_MEDIA=512`, `VOLUME_STEP=1024`, `SELECT_SOURCE=2048`, `STOP=4096`, `CLEAR_PLAYLIST=8192`, `PLAY=16384`, `SHUFFLE_SET=32768`, `SELECT_SOUND_MODE=65536`, `BROWSE_MEDIA=131072`, `REPEAT_SET=262144`, `GROUPING=524288`, `MEDIA_ANNOUNCE=1048576`, `MEDIA_ENQUEUE=2097152`, and `SEARCH_MEDIA=4194304`. States are `off`, `on`, `idle`, `playing`, `paused`, and `buffering`; metadata includes content ID/type, duration, playback position and timestamp, title, artist, album, album artist, track, series, season, episode, channel, playlist, app ID/name, input source, sound mode, shuffle, repeat mode, group members, volume, mute state, and local artwork. citeturn232659view3

For `lock`, Core states include `jammed`, `opening`, `locking`, `open`, `unlocking`, `locked`, and `unlocked`; the current feature mask contains `OPEN=1`. Core services are lock, unlock, and open and can carry a `code`; `code_format` and `changed_by` are state attributes. Persistent PIN-slot/access-code management is not part of the generic HA `lock` entity contract and must therefore be represented as integration-specific services/entities when present. citeturn762471view3

For `cover`, feature bits are `OPEN=1`, `CLOSE=2`, `SET_POSITION=4`, `STOP=8`, `OPEN_TILT=16`, `CLOSE_TILT=32`, `STOP_TILT=64`, `SET_TILT_POSITION=128`, and `SPEED=256`; state information includes current position, current tilt position, closed state, and supported speeds. citeturn232659view2

Haus should preserve feature masks verbatim in `sourceRefs`, even after translating them into normalized capabilities. That makes round-trip debugging possible when an integration changes behavior across Home Assistant releases.

## HomeKit service and characteristic inventory

HAP-NodeJS is unusually useful as a practical registry because its definitions are generated from Apple HomeKit metadata. Its current generated files identify themselves as metadata version `V=889`, and the project documentation explicitly identifies `ServiceDefinitions.ts` and `CharacteristicDefinitions.ts` as its complete service/characteristic definitions. citeturn744416view0turn523657search6

### Complete current HAP-NodeJS service registry

The complete service class inventory exposed by the current generated/runtime registry is:

1. `AccessCode`
2. `AccessControl`
3. `AccessoryInformation`
4. `AccessoryMetrics`
5. `AccessoryRuntimeInformation`
6. `AirPurifier`
7. `AirQualitySensor`
8. `AssetUpdate`
9. `Assistant`
10. `AudioStreamManagement`
11. `Battery`
12. `CameraOperatingMode`
13. `CameraRecordingManagement`
14. `CameraRTPStreamManagement`
15. `CarbonDioxideSensor`
16. `CarbonMonoxideSensor`
17. `CloudRelay` — removed/deprecated
18. `ContactSensor`
19. `DataStreamTransportManagement`
20. `Diagnostics`
21. `Door`
22. `Doorbell`
23. `Fan`
24. `Fanv2`
25. `Faucet`
26. `FilterMaintenance`
27. `FirmwareUpdate`
28. `GarageDoorOpener`
29. `HeaterCooler`
30. `HumidifierDehumidifier`
31. `HumiditySensor`
32. `InputSource`
33. `IrrigationSystem`
34. `LeakSensor`
35. `Lightbulb`
36. `LightSensor`
37. `LockManagement`
38. `LockMechanism`
39. `Microphone`
40. `MotionSensor`
41. `NFCAccess`
42. `OccupancySensor`
43. `Outlet`
44. `Pairing`
45. `PowerManagement`
46. `ProtocolInformation`
47. `SecuritySystem`
48. `ServiceLabel`
49. `Siri`
50. `SiriEndpoint`
51. `Slats`
52. `SmartSpeaker`
53. `SmokeSensor`
54. `Speaker`
55. `StatefulProgrammableSwitch`
56. `StatelessProgrammableSwitch`
57. `Switch`
58. `TapManagement` — removed/deprecated
59. `TargetControl`
60. `TargetControlManagement`
61. `Television`
62. `TelevisionSpeaker`
63. `TemperatureSensor`
64. `Thermostat`
65. `ThreadTransport`
66. `TransferTransportManagement`
67. `Tunnel` — removed/deprecated
68. `Valve`
69. `WiFiRouter`
70. `WiFiSatellite`
71. `WiFiTransport`
72. `Window`
73. `WindowCovering`

This registry includes services that were historically private or undocumented in public HAP releases, including television/control, Siri, Thread transport, diagnostics, firmware/update transport, NFC access, Wi-Fi router, and HKSV/HDS services. citeturn209677search2turn988118view0turn988118view1turn988118view2turn988118view3

Representative canonical UUIDs that matter most to Haus passthrough include `AccessCode=00000260-0000-1000-8000-0026BB765291`, `CarbonDioxideSensor=00000097-0000-1000-8000-0026BB765291`, `CarbonMonoxideSensor=0000007F-0000-1000-8000-0026BB765291`, `DataStreamTransportManagement=00000129-0000-1000-8000-0026BB765291`, `Diagnostics=00000237-0000-1000-8000-0026BB765291`, `Door=00000081-0000-1000-8000-0026BB765291`, `Doorbell=00000121-0000-1000-8000-0026BB765291`, `Fan=00000040-0000-1000-8000-0026BB765291`, `Fanv2=000000B7-0000-1000-8000-0026BB765291`, `IrrigationSystem=000000CF-0000-1000-8000-0026BB765291`, `Lightbulb=00000043-0000-1000-8000-0026BB765291`, `LockManagement=00000044-0000-1000-8000-0026BB765291`, `LockMechanism=00000045-0000-1000-8000-0026BB765291`, `MotionSensor=00000085-0000-1000-8000-0026BB765291`, `NFCAccess=00000266-0000-1000-8000-0026BB765291`, `TargetControl=00000125-0000-1000-8000-0026BB765291`, `TargetControlManagement=00000122-0000-1000-8000-0026BB765291`, `Television=000000D8-0000-1000-8000-0026BB765291`, `WiFiRouter=0000020A-0000-1000-8000-0026BB765291`, `WiFiSatellite=0000020F-0000-1000-8000-0026BB765291`, `WiFiTransport=0000022A-0000-1000-8000-0026BB765291`, `Window=0000008B-0000-1000-8000-0026BB765291`, and `WindowCovering=0000008C-0000-1000-8000-0026BB765291`. citeturn523657search1turn988118view0turn988118view1turn988118view2turn988118view3

### Complete current generated characteristic-symbol registry

The current generated HAP-NodeJS registry exposes the following characteristic definitions individually; Haus should generate its HAP metadata table directly from `CharacteristicDefinitions.ts`, preserving each characteristic's exact UUID, format, permissions, unit, bounds, step, valid-values set, and administrative/timed-write metadata rather than maintaining this metadata manually. citeturn523657search12turn744416view0

1. `AccessCodeControlPoint`
2. `AccessCodeSupportedConfiguration`
3. `AccessControlLevel`
4. `AccessoryFlags`
5. `AccessoryIdentifier`
6. `Active`
7. `ActiveIdentifier`
8. `ActivityInterval`
9. `AdministratorOnlyAccess`
10. `AirParticulateDensity`
11. `AirParticulateSize`
12. `AirPlayEnable`
13. `AirQuality`
14. `AppMatchingIdentifier`
15. `AssetUpdateReadiness`
16. `AudioFeedback`
17. `BatteryLevel`
18. `Brightness`
19. `ButtonEvent`
20. `CameraOperatingModeIndicator`
21. `CarbonDioxideDetected`
22. `CarbonDioxideLevel`
23. `CarbonDioxidePeakLevel`
24. `CarbonMonoxideDetected`
25. `CarbonMonoxideLevel`
26. `CarbonMonoxidePeakLevel`
27. `CCAEnergyDetectThreshold`
28. `CCASignalDetectThreshold`
29. `CharacteristicValueActiveTransitionCount`
30. `CharacteristicValueTransitionControl`
31. `ChargingState`
32. `ClosedCaptions`
33. `ColorTemperature`
34. `ConfigurationState`
35. `ConfiguredName`
36. `ConnectionHealthMonitor`
37. `ContactSensorState`
38. `CoolingThresholdTemperature`
39. `CryptoHash`
40. `CurrentAirPurifierState`
41. `CurrentAmbientLightLevel`
42. `CurrentDoorState`
43. `CurrentFanState`
44. `CurrentHeaterCoolerState`
45. `CurrentHeatingCoolingState`
46. `CurrentHorizontalTiltAngle`
47. `CurrentHumidifierDehumidifierState`
48. `CurrentMediaState`
49. `CurrentPosition`
50. `CurrentRelativeHumidity`
51. `CurrentSlatState`
52. `CurrentTemperature`
53. `CurrentTiltAngle`
54. `CurrentTransport`
55. `CurrentVerticalTiltAngle`
56. `CurrentVisibilityState`
57. `DataStreamHAPTransport`
58. `DataStreamHAPTransportInterrupt`
59. `DiagonalFieldOfView`
60. `DigitalZoom`
61. `DisplayOrder`
62. `EventRetransmissionMaximum`
63. `EventSnapshotsActive`
64. `EventTransmissionCounters`
65. `FilterChangeIndication`
66. `FilterLifeLevel`
67. `FirmwareRevision`
68. `FirmwareUpdateProtocolList`
69. `FirmwareUpdateReadiness`
70. `FirmwareUpdateStatus`
71. `HardwareFinish`
72. `HardwareRevision`
73. `HeartBeat`
74. `HeatingThresholdTemperature`
75. `HoldPosition`
76. `HomeKitCameraActive`
77. `Hue`
78. `Identifier`
79. `Identify`
80. `ImageMirroring`
81. `ImageRotation`
82. `InputDeviceType`
83. `InputSourceType`
84. `InUse`
85. `IsConfigured`
86. `LeakDetected`
87. `ListPairings`
88. `LockControlPoint`
89. `LockCurrentState`
90. `LockLastKnownAction`
91. `LockManagementAutoSecurityTimeout`
92. `LockPhysicalControls`
93. `LockTargetState`
94. `Logs`
95. `MACRetransmissionMaximum`
96. `MACTransmissionCounters`
97. `ManagedNetworkEnable`
98. `ManuallyDisabled`
99. `Manufacturer`
100. `MatterFirmwareRevisionNumber`
101. `MatterFirmwareUpdateStatus`
102. `MaximumTransmitPower`
103. `MediaAccessControlLevel`
104. `MetricsBufferFullState`
105. `Model`
106. `MotionDetected`
107. `MultifunctionButton`
108. `Mute`
109. `Name`
110. `NetworkAccessViolationControl`
111. `NetworkClientProfileControl`
112. `NetworkClientStatusControl`
113. `NFCAccessControlPoint`
114. `NFCAccessSupportedConfiguration`
115. `NightVision`
116. `NitrogenDioxideDensity`
117. `ObstructionDetected`
118. `OccupancyDetected`
119. `On`
120. `OperatingStateResponse`
121. `OpticalZoom`
122. `OutletInUse`
123. `OzoneDensity`
124. `PairingFeatures`
125. `PairSetup`
126. `PairVerify`
127. `PasswordSetting`
128. `PeriodicSnapshotsActive`
129. `PictureMode`
130. `Ping`
131. `PM10Density`
132. `PM2_5Density`
133. `PositionState`
134. `PowerModeSelection`
135. `PreferredWiFiList`
136. `ProductData`
137. `ProgrammableSwitchEvent`
138. `ProgrammableSwitchOutputState`
139. `ProgramMode`
140. `ReceivedSignalStrengthIndication`
141. `ReceiverSensitivity`
142. `RecordingAudioActive`
143. `RelativeHumidityDehumidifierThreshold`
144. `RelativeHumidityHumidifierThreshold`
145. `RelayControlPoint`
146. `RelayEnabled`
147. `RelayState`
148. `RemainingDuration`
149. `RemoteKey`
150. `ResetFilterIndication`
151. `RotationDirection`
152. `RotationSpeed`
153. `RouterStatus`
154. `Saturation`
155. `SecuritySystemAlarmType`
156. `SecuritySystemCurrentState`
157. `SecuritySystemTargetState`
158. `SelectedAudioStreamConfiguration`
159. `SelectedCameraRecordingConfiguration`
160. `SelectedDiagnosticsModes`
161. `SelectedRTPStreamConfiguration`
162. `SelectedSessionKeepaliveConfigurationList`
163. `SelectedSleepConfiguration`
164. `SerialNumber`
165. `ServiceLabelIndex`
166. `ServiceLabelNamespace`
167. `SetDuration`
168. `SetupDataStreamTransport`
169. `SetupEndpoints`
170. `SetupTransferTransport`
171. `SignalToNoiseRatio`
172. `SiriEnable`
173. `SiriEndpointSessionStatus`
174. `SiriEngineVersion`
175. `SiriInputType`
176. `SiriLightOnUse`
177. `SiriListening`
178. `SiriTouchToUse`
179. `SlatType`
180. `SleepDiscoveryMode`
181. `SleepInterval`
182. `SmokeDetected`
183. `SoftwareRevision`
184. `StagedFirmwareVersion`
185. `StatusActive`
186. `StatusFault`
187. `StatusJammed`
188. `StatusLowBattery`
189. `StatusTampered`
190. `StreamingStatus`
191. `SulphurDioxideDensity`
192. `SupportedAssetTypes`
193. `SupportedAudioRecordingConfiguration`
194. `SupportedAudioStreamConfiguration`
195. `SupportedCameraRecordingConfiguration`
196. `SupportedCharacteristicValueTransitionConfiguration`
197. `SupportedDataStreamTransportConfiguration`
198. `SupportedDiagnosticsModes`
199. `SupportedDiagnosticsSnapshot`
200. `SupportedFirmwareUpdateConfiguration`
201. `SupportedMetrics`
202. `SupportedRouterConfiguration`
203. `SupportedRTPConfiguration`
204. `SupportedSessionKeepaliveConfigurationList`
205. `SupportedSleepConfiguration`
206. `SupportedTransferTransportConfiguration`
207. `SupportedVideoRecordingConfiguration`
208. `SupportedVideoStreamConfiguration`
209. `SwingMode`
210. `TapType`
211. `TargetAirPurifierState`
212. `TargetControlList`
213. `TargetControlSupportedConfiguration`
214. `TargetDoorState`
215. `TargetFanState`
216. `TargetHeaterCoolerState`
217. `TargetHeatingCoolingState`
218. `TargetHorizontalTiltAngle`
219. `TargetHumidifierDehumidifierState`
220. `TargetMediaState`
221. `TargetPosition`
222. `TargetRelativeHumidity`
223. `TargetTemperature`
224. `TargetTiltAngle`
225. `TargetVerticalTiltAngle`
226. `TargetVisibilityState`
227. `TemperatureDisplayUnits`
228. `ThirdPartyCameraActive`
229. `ThreadControlPoint`
230. `ThreadNodeCapabilities`
231. `ThreadOpenThreadVersion`
232. `ThreadStatus`
233. `Token`
234. `TransmitPower`
235. `TunnelConnectionTimeout`
236. `TunneledAccessoryAdvertising`
237. `TunneledAccessoryConnected`
238. `TunneledAccessoryStateNumber`
239. `ValveType`
240. `Version`
241. `VideoAnalysisActive`
242. `VOCDensity`
243. `Volume`
244. `VolumeControlType`
245. `VolumeSelector`
246. `WakeConfiguration`
247. `WANConfigurationList`
248. `WANStatusList`
249. `WaterLevel`
250. `WiFiCapabilities`
251. `WiFiConfigurationControl`
252. `WiFiSatelliteStatus`

The generated source provides the exact UUID and constraints for each symbol. Examples include `AccessCodeControlPoint=00000262-0000-1000-8000-0026BB765291`, `AccessCodeSupportedConfiguration=00000261-0000-1000-8000-0026BB765291`, `Active=000000B0-0000-1000-8000-0026BB765291`, `AirPlayEnable=0000025B-0000-1000-8000-0026BB765291`, `ConfigurationState=00000263-0000-1000-8000-0026BB765291`, `HomeKitCameraActive=0000021B-0000-1000-8000-0026BB765291`, `NFCAccessSupportedConfiguration` as the corresponding NFC-access TLV characteristic, `SecuritySystemCurrentState=00000066-0000-1000-8000-0026BB765291`, and `SecuritySystemTargetState=00000067-0000-1000-8000-0026BB765291`. citeturn744416view0turn292116view1turn292116view2turn292116view3

For implementation, **do not manually retype UUID metadata into Haus source code**. Build a generation step pinned to the HAP-NodeJS metadata version and commit the generated Haus registry. This satisfies lossless requirements while preventing transcription errors when Apple adds private metadata.

### Cameras, HKSV, media, locks, NFC, networking, and Thread

HKSV is represented by the combination of `CameraRTPStreamManagement`, `CameraOperatingMode`, `CameraRecordingManagement`, and `DataStreamTransportManagement`; HAP-NodeJS's `CameraController` automatically creates the recording, operating-mode, and data-stream services when Secure Video recording is enabled. It explicitly describes a recording delegate maintaining a prebuffer and delivering recordings when the controller opens a recording session. citeturn845297search1

The correct Haus pipeline is therefore:

```text
Camera source
   │
   ├─ encoded H.264/H.265 elementary stream
   ├─ encoded audio
   └─ event metadata
        │
        ▼
Media broker
   ├─ live SRTP packetizer
   ├─ HKSV prebuffer
   ├─ fMP4/CMAF fragmenter
   ├─ WebRTC packetizer
   ├─ RTSP server/client
   └─ snapshot extractor
```

A native-HAP-to-HAP camera proxy cannot literally forward an upstream HKSV HDS TCP connection into Apple because the upstream and downstream HAP/HDS authentication contexts are different. It can, however, terminate both HDS sessions and relay compatible encoded frames or fragments without decode/re-encode. That distinction—**zero-transcode relay rather than cryptographic passthrough**—should be a core media abstraction.

Scrypted provides useful production evidence for this design: it supports HKSV and deliberately defaults each camera to accessory mode because HomeKit serializes requests through a bridge and a slow snapshot from one camera can delay traffic for other bridged devices. Its documentation also reports HKSV v3 support arriving in September 2026 with newer transports and H.265-related support, so Haus should keep media transport/versioning extensible rather than hard-code the earlier H.264-only assumption. citeturn104367search5

HomeKey-class functionality is represented by `AccessCode`/`NFCAccess` and characteristics including `ConfigurationState`, `AccessCodeControlPoint`, `AccessCodeSupportedConfiguration`, `NFCAccessControlPoint`, and `NFCAccessSupportedConfiguration`; the generated HAP metadata marks `NFCAccess` as present since iOS 15. citeturn988118view1turn744416view0

HomeKit Secure Router functionality is represented by `WiFiRouter`, `WiFiSatellite`, and `WiFiTransport`; required router characteristics include configured name, managed-network enablement, network-access-violation control, network-client profile/status control, router status, supported-router configuration, WAN configuration, and WAN status. citeturn988118view3

Thread-related private HAP metadata includes `ThreadTransport`, `ThreadControlPoint`, `ThreadNodeCapabilities`, `ThreadOpenThreadVersion`, and `ThreadStatus`; these should be preserved if encountered but should not be treated as a replacement for Matter's native Thread-network commissioning model. citeturn523657search12

### Matter robot vacuums versus legacy HomeKit emulation

Do not create a fake HAP `Fan`, `Switch`, or `HeaterCooler` as Haus's primary Apple export for a robot vacuum. Matter's RVC device model is now the correct compatibility surface. Apple’s developer material added robot-vacuum Matter support, and current Apple compatibility guidance explicitly includes robot vacuum cleaners. citeturn408123search5turn408123search8

A Haus bridged vacuum should expose a Matter RVC endpoint with at least:

```text
Descriptor
Identify
RVC Run Mode             cluster 0x0054
RVC Clean Mode           cluster 0x0055 when supported
RVC Operational State    cluster 0x0061
Service Area             when supported by the selected Matter revision/profile
Power Source             when applicable
Operational Credentials / General Commissioning at node scope
```

The canonical Haus vacuum remains richer than the Matter endpoint; map room/segment IDs, maps, vendor cleaning parameters, consumable state, dock controls, and arbitrary commands to Generic characteristics when the chosen Matter revision cannot express them.

## Device migration and universal mapping engine

### Grouping Home Assistant entities

The primary grouping key is Home Assistant's **device-registry `device_id`**. Every HA entity sharing that identifier should normally become a service or characteristic under the same Haus logical device.

For an Aqara-style camera, the result can be:

```text
Device: Hallway Camera
├── Service: Camera
│   ├── stream
│   ├── snapshot
│   └── recordingEnabled
├── Service: MotionSensor
│   └── motionDetected
├── Service: Light
│   ├── on
│   └── brightness
├── Service: Siren
│   ├── active
│   └── tone
├── Service: GenericConfiguration
│   ├── detectionSensitivity : GenericEnum
│   ├── cooldownSeconds      : GenericInt
│   └── privacyMode          : GenericBoolean
└── Service: Diagnostics
    ├── signalStrength
    ├── battery
    └── firmware
```

A four-gang power strip can become one Haus Device with four Outlet/Switch services and one Measurement service per channel, or one shared Measurement service when the physical device reports only aggregate power.

The mapping algorithm should be deterministic:

```text
resolveEntity(entity):
    sourceDevice = HA device registry entry

    if sourceDevice.device_id exists:
        hausDeviceKey = "ha:device:" + configEntryId + ":" + device_id
    else:
        hausDeviceKey = "ha:entity:" + entityRegistryId

    classify entity domain/device_class
    choose native Haus service profile
    attach core state as primary characteristic
    attach standardized attributes as typed characteristics
    attach unconsumed attributes as Generic characteristics
    persist source entity ID and registry identity
```

Entities without a device-registry parent must **not be merged merely because their names look similar**. A synthetic device can be merged later by an explicit user rule or an integration-specific deterministic rule.

### Mapping examples

`binary_sensor.motion` → `MotionSensor.motionDetected`.

`binary_sensor.door`, `binary_sensor.window`, `binary_sensor.opening`, `binary_sensor.garage_door` → Contact/Open-state services, preserving the original device class.

`sensor.temperature` → `TemperatureSensor.currentTemperature`.

`sensor.humidity` → `HumiditySensor.currentRelativeHumidity`.

`sensor.illuminance` → `LightSensor.currentAmbientLightLevel`.

`sensor.pm25`, `pm10`, `carbon_dioxide`, `volatile_organic_compounds`, `nitrogen_dioxide`, `ozone` → AirQuality service characteristics where HAP has a defined characteristic; otherwise retain the native sensor characteristic in Haus and export through Matter/Generic surfaces as available.

`switch.outlet` → Outlet.

`switch.switch` → Switch.

`button.identify` → GenericAction/Identify.

`number` → a semantic native target characteristic if its entity/device class identifies one; otherwise `GenericInt` or `GenericFloat`.

`select` → `GenericEnum`.

`text` → `GenericString`.

`button` → `GenericAction`.

`update` → Firmware/Software Update service when semantically safe; otherwise GenericAction plus version/status characteristics.

`event` → event characteristic with last-event type and timestamp.

`calendar` and `todo` → data-oriented service profiles rather than fake switches.

`notify`, `tts`, `stt`, `conversation`, `ai_task`, `assist_satellite`, and `wake_word` → callable/application services and actions, not physical-control toggles.

`image` and `camera` → media services.

`scene` → `GenericAction` plus immutable scene identity.

`remote` → RemoteControl service with command actions; if it represents television semantics, optionally project into HAP TargetControl/Television.

`weather` → Weather service with typed subcharacteristics for temperature, humidity, pressure, wind, precipitation, condition, forecast data, and timestamped forecast records.

`device_tracker` → Presence/Location service; exact geographic coordinates should have a separate privacy classification from boolean presence.

### Generic HomeKit exposure

HomeKit custom UUIDs are valid at the protocol level; HAP-NodeJS explicitly supports custom characteristics and services, although Siri and Apple Home do not necessarily render them. citeturn523657search0

Haus should therefore implement three exporter policies:

```text
native-only
    Preserve Generic characteristic inside Haus.
    Do not expose to Apple Home.

custom-hap
    Emit Haus-owned custom service/characteristic UUID.
    Best for third-party HomeKit clients that understand Haus metadata.

compatibility-projection
    Expose a controlled virtual native service:
      GenericBoolean -> Switch
      GenericAction  -> stateless/temporary Switch or programmable event
      GenericEnum    -> InputSource set where semantically defensible
      bounded 0..100 numeric control -> slider-compatible native characteristic
```

Compatibility projection must be opt-in because pretending an arbitrary number is brightness or an arbitrary enum is a television source corrupts semantics.

Haus-owned custom UUIDs should be generated from a **registered static namespace**, never random on each boot:

```text
UUIDv5(
  namespace = HAUS_HAP_NAMESPACE,
  name = canonicalHausCharacteristicType
)
```

The same logical characteristic must receive the same UUID across every installation and release.

### Bridges, child accessories, and linked services

Internally, the word “bridge” should mean a **transport/device aggregation relationship**, not determine how the data is stored.

HAP export chooses among:

```text
HapBridgePublisher
  one HAP pairing identity
  AID 1 = bridge
  AID 2..N = bridged accessories

HapStandalonePublisher
  one HAP pairing identity per Haus device/profile

HapSpecializedPublisher
  standalone camera / television / HomeKey / networking publication
```

HAP-NodeJS enforces a maximum of 149 bridged accessories in addition to the bridge itself and forbids bridging an already-published accessory or another bridge. citeturn845297search0

`linkedServices` should represent relationships *within one accessory*: a camera linked to motion/occupancy, an irrigation system linked to valves, a television linked to InputSource services, or a fan linked to filter maintenance. HAP-NodeJS serializes linked services by IID. citeturn523657search4

Publication policy should be configurable:

```text
STANDARD_BRIDGE
ISOLATED_ACCESSORY
CAMERA_ACCESSORY
TV_ACCESSORY
HOMEKEY_ACCESSORY
ROUTER_ACCESSORY
MATTER_AGGREGATOR_ENDPOINT
```

## Lossless HomeKit passthrough and commissioning

### Inbound HAP controller

For a native HomeKit accessory paired to Haus:

```text
mDNS discovery
    ↓
Pair Setup
    ↓
persist controller/accessory long-term keys
    ↓
Pair Verify
    ↓
encrypted HAP session
    ↓
GET /accessories
    ↓
raw accessory graph store
    ↓
semantic mapper
    ↓
Haus canonical graph
```

The raw graph store should preserve both the parsed representation and the original protocol metadata:

```ts
interface RawHapAccessory {
  aid: number;
  services: RawHapService[];
}

interface RawHapService {
  iid: number;
  type: string;
  primary?: boolean;
  hidden?: boolean;
  linked?: number[];
  characteristics: RawHapCharacteristic[];
}

interface RawHapCharacteristic {
  iid: number;
  type: string;
  value?: unknown;
  perms: string[];
  format?: string;
  unit?: string;
  minValue?: number;
  maxValue?: number;
  minStep?: number;
  maxLen?: number;
  maxDataLen?: number;
  validValues?: number[];
  validValuesRange?: [number, number];
  description?: string;
  rawMetadata: Record<string, unknown>;
}
```

Unknown UUIDs must never prevent ingestion. Unknown services become `GenericProtocolService`; unknown characteristics are typed from their HAP `format` and retained with their original UUID.

For a TypeScript-only inbound controller, `hap-controller` remains a useful IP/BLE library, but it is materially less active and less comprehensive than the Home Assistant controller stack. Its published documentation supports Wi-Fi and BLE HAP discovery/control. citeturn104367search0turn104367search8

For maximum compatibility, `aiohomekit` should be treated as the reference implementation or sidecar option. It is explicitly the HAP controller library primarily used by Home Assistant, remains active in 2026, and current issue activity demonstrates CoAP/Thread transport support. Its README notes that BLE is not currently supported in its modern architecture, so it should not be described as a universal IP+BLE+CoAP library without qualification. citeturn104367search1turn104367search2turn104367search9

### Outbound HAP reconstruction

For each inbound object, retain a stable mapping:

```text
upstream accessory identity
    upstream AID
    upstream service IID
    upstream characteristic IID
          │
          ▼
persistent Haus proxy identity
          │
          ▼
outbound HAP AID/IID
```

Do not promise identical numerical AIDs/IIDs if HAP-NodeJS needs to allocate them differently. Promise **stable semantic identity** and maintain the upstream IDs as metadata.

Read:

```text
Apple controller GET
→ outbound HAP characteristic
→ Haus binding
→ cached value or upstream GET
→ validate/translate format
→ return
```

Write:

```text
Apple controller PUT
→ authorization/timed-write handling
→ Haus characteristic
→ upstream HAP write
→ propagate HAP status
→ update local canonical value
```

Notify:

```text
upstream HAP event
→ canonical state event
→ outbound HAP event subscriptions
→ Apple controller
```

For TLV8 or unknown binary characteristics, use **opaque relay mode** unless a translator explicitly understands the schema.

### HomeKit pairing payload

HAP-NodeJS exposes the exact current setup-URI construction algorithm. It strips hyphens from the eight-digit setup PIN; places the setup PIN into the lower value; sets bit 28 to indicate IP support; divides the accessory category across the high and category-parity bit; converts the resulting 64-bit integer to uppercase base-36 padded to nine characters; and appends the four-character setup ID after `X-HM://`. citeturn315338view0turn315338view1

Equivalent pseudocode:

```ts
const pin = parseInt(pincode.replace(/-/g, ""), 10);

let low = pin;
let high = category >> 1;

low |= 1 << 28; // Supports IP

if (category & 1) {
  low |= 1 << 31;
}

const packed = BigInt(low >>> 0) + (BigInt(high >>> 0) << 32n);

const payload =
  packed.toString(36).toUpperCase().padStart(9, "0");

const setupURI =
  `X-HM://${payload}${setupID}`;
```

HAP-NodeJS requires a stable MAC-formatted username/accessory identity, an eight-digit PIN of the HAP form, and optionally a four-character setup ID. Those values must be persisted for the lifetime of the exported accessory because changing identity can make HomeKit treat it as a different accessory. citeturn845297search6turn845297search4

Haus should generate:

```text
HAP username     = cryptographically random locally-administered MAC,
                   persisted permanently
HAP PIN          = randomly generated valid HAP setup PIN,
                   persisted unless explicit reset
HAP setup ID     = random four-character setup ID,
                   persisted
QR payload       = X-HM://...
```

The QR should be rendered in the mobile/desktop UI, but its authoritative payload and pairing identity should be generated and stored on the Hub.

### Matter multi-admin sharing

Matter’s multi-admin model is fundamentally different from HomeKit bridge pairing. An already-commissioned Matter node is already on Haus's fabric. With user authorization, Haus opens a new commissioning window so another administrator can establish a new fabric. Matter requires support for the Enhanced Commissioning Method; the Administrator Commissioning cluster's `OpenCommissioningWindow` command is invoked over an existing CASE-secured session. citeturn747323search10

The flow should be:

```text
Haus Fabric A
   │ CASE
   ▼
Matter device
   │
   │ OpenCommissioningWindow
   │  - timeout
   │  - PAKE verifier
   │  - discriminator
   │  - iteration count
   │  - salt
   ▼
temporary commissioning mode
   │
   ├─ BLE/IP discovery
   │
Apple / Google commissioner
   │
   ├─ PASE
   ├─ fail-safe
   ├─ attestation
   ├─ CSR
   ├─ AddTrustedRootCertificate
   ├─ AddNOC
   ├─ ACL/fabric installation
   ├─ operational discovery
   ├─ CASE on new fabric
   └─ CommissioningComplete
```

The general commissioning sequence—PASE, network provisioning where necessary, operational credentials, operational discovery, CASE, and CommissioningComplete—is documented by Google’s Matter commissioning material and corresponds to the standard model. citeturn747323search7

The **Enhanced Commissioning Method** should be the default because it creates a fresh commissioning verifier/passcode for the new window rather than reusing the product's original setup passcode. Matter APIs expose commissioning-window duration, discriminator, and passcode parameters; implementations also reject reserved/insecure passcodes. citeturn747323search4

Haus API:

```ts
interface MatterShareRequest {
  nodeId: bigint;
  expiresSeconds: number;
  targetEcosystem?: "apple" | "google" | "other";
}

interface MatterSharePayload {
  qrPayload: string;          // MT:...
  manualPairingCode: string; // 11- or 21-digit representation as applicable
  discriminator: number;
  expiresAt: string;
}
```

Apple explicitly tells users that previously paired Matter accessories can be selected and added to another ecosystem, and Apple setup UI accepts 11- or 21-digit Matter manual codes in addition to QR codes. citeturn408123search1turn408123search3

The mobile client should show the code and hand it to Apple/Google's native commissioning surface. The Hub must own the actual Matter controller fabric, CASE credentials, commissioning-window command, fabric table, ACL management, and revocation.

### Security system mapping

Use a policy table rather than static aliases:

```text
Haus state                HomeKit current             HomeKit target
----------------------------------------------------------------------
DISARMED                  DISARMED                    DISARM
ARMED_HOME                STAY_ARM                    STAY_ARM
ARMED_AWAY                AWAY_ARM                    AWAY_ARM
ARMED_NIGHT               NIGHT_ARM                   NIGHT_ARM
TRIGGERED                 ALARM_TRIGGERED             unchanged
ARMING_*                  prior stable / policy       requested target
DISARMING                 prior stable / policy       DISARM
PENDING                   prior armed state           unchanged
ARMED_VACATION            configurable mapping         configurable mapping
ARMED_CUSTOM              configurable mapping         configurable mapping
FAULT                     prior state + StatusFault    unchanged
```

Never map `TRIGGERED` to an arm target. Never convert `pending`, `arming`, or `disarming` into `ALARM_TRIGGERED`. Vacation/custom modes require explicit configured projection because HAP does not have matching target values. citeturn762471view0turn292116view3

## Matter, Thread, Zigbee, HomeKit, media, and responsibility split

### Matter stack

For a Node.js/TypeScript product in late 2026, **`matter.js` should be Haus's primary Matter implementation**. The project is a complete TypeScript Matter implementation supporting controllers, devices, commissioning, bridges, secure communication, cluster models, Node.js, and related JavaScript environments. citeturn725562search0turn725562search1

The recommended layering is:

```text
Haus Core
  │
  ├── matter.js Controller
  │      └── commissions and controls physical Matter nodes
  │
  └── matter.js Aggregator/Bridge
         ├── endpoint: HA light
         ├── endpoint: Zigbee thermostat
         ├── endpoint: HAP lock
         └── endpoint: HA/Zigbee vacuum RVC
```

The `connectedhomeip` / CHIP SDK remains the official upstream Matter SDK and is the right C++ choice for embedded products, certification reference work, lower-level protocol debugging, or features not yet exposed by the JavaScript stack. citeturn725562search4

`python-matter-server` should **not** be selected as Haus's long-term primary stack in 2026. Its repository describes its final line as unmaintained after the ecosystem moved to the matter.js server, and Home Assistant’s Matter Server application changelog records the replacement of the Python implementation by the matter.js implementation with data migration. citeturn725562search6turn725562search7

Current Matter protocol development has already moved beyond the user's originally implied Matter 1.2–1.4 horizon: Matter 1.5 shipped in November 2025, 1.5.1 in March 2026, Matter 1.6 in June 2026, and CSA currently publishes 1.6/1.6.1 material. Matter 1.6 introduced commissioning/co-administration improvements including Joint Fabric work, while 1.5 added additional device/network capabilities. Haus must therefore model cluster versions dynamically rather than treating Matter 1.4 as a ceiling. citeturn747323search0turn747323search1turn747323search2turn747323search3

### Thread Border Router

Use upstream **OpenThread Border Router (`ot-br-posix`)** with the radio in **RCP mode**.

Recommended hardware:

```text
Haus Linux SBC / appliance
├── Ethernet / Wi-Fi backbone
├── dedicated Thread radio
│   ├── EFR32MG21
│   ├── EFR32MG24
│   └── nRF52840
└── dedicated Zigbee radio
```

The Thread path is:

```text
802.15.4 RCP
   │ Spinel over UART/USB/SPI
   ▼
otbr-agent
   │
   ├── wpan0
   ├── Thread IPv6 routing
   ├── Thread network data
   ├── on-mesh prefixes
   ├── off-mesh routes
   ├── backbone interface
   ├── SRP/mDNS service discovery
   └── TREL
        │
        ▼
Ethernet / Wi-Fi LAN
```

Upstream OTBR documents an RCP architecture and support for routing, mDNS/SRP service discovery, Thread-over-infrastructure/TREL, and external commissioning. Its native configuration uses `otbr-agent`, a Thread interface such as `wpan0`, a backbone interface, and Spinel radio URLs. citeturn488140search8turn488140search7

Home Assistant’s current OTBR app is a particularly useful reference implementation: it wraps upstream OTBR, requires a supported 802.15.4 radio running OpenThread RCP firmware, and launches `otbr-agent` with a Spinel HDLC UART URL plus TREL on the backbone interface. citeturn196029search6turn196029search9

Do not put a latency-sensitive Spinel RCP behind an unreliable TCP tunnel. Home Assistant explicitly warns that OTBR expects a reliable UART/SPI-class link and that remote-IP RCP failures can leave stale routes until route lifetimes expire. citeturn196029search7

### Thread credential sharing

The Active Operational Dataset is the authoritative object to exchange, not a hand-built set of network-name/password fields.

On Apple platforms, `ThreadNetwork` APIs expose protected Thread credentials backed by iCloud Keychain and permit applications with the required entitlement/user authorization to retrieve preferred credentials or store an Active Operational Dataset. Apple’s credential object exposes channel, extended PAN ID, network key, network name, PAN ID, and PSKc. citeturn488140search0turn488140search1turn488140search3

On Android, Google Play Services' Thread Network API provides `ThreadNetworkClient` operations for preferred credentials, active credentials, adding credentials, creating datasets, and importing an Active Operational Dataset. Google currently documents the `play-services-threadnetwork` SDK for this purpose. citeturn586296search0turn586296search1

The correct Haus flow is:

```text
Mobile app
  │
  ├─ request OS permission / entitlement
  ├─ retrieve preferred Thread dataset
  └─ send dataset locally over authenticated Haus channel
        │
        ▼
Haus Hub
  ├─ validate dataset
  ├─ import into OTBR
  ├─ activate dataset
  └─ persist encrypted network dataset
```

Or, when Haus created the network first:

```text
Haus OTBR creates AOD
        │
        ▼
Haus mobile app
        │
        ├─ authenticated retrieval
        └─ OS Thread API stores credentials
                │
                ▼
        Apple / Android preferred Thread network
```

This prevents the common failure mode in which the hub, Apple Home, and Google Home each create distinct Thread meshes. Apple explicitly provides APIs intended to configure a border router with preferred credentials rather than fragmenting the home into separate networks. citeturn488140search5

### Zigbee

Home Assistant ZHA is built on `zigpy`; Silicon Labs radios use `bellows`, TI ZNP radios use `zigpy-znp`, and deCONZ radios use `zigpy-deconz`. `zha-device-handlers` supplies quirks to compensate for vendor-specific behavior. citeturn281804search0turn281804search7turn281804search8turn281804search9turn281804search10

For Haus's TypeScript architecture, use:

```text
zigbee-herdsman
    coordinator/network/ZDO/ZCL transport

zigbee-herdsman-converters
    device fingerprints
    exposes
    fromZigbee converters
    toZigbee converters
    configure hooks
    manufacturer quirks

Haus Zigbee Adapter
    converts exposes to Haus Device/Service/Characteristic
```

No MQTT broker is technically required when embedding these libraries. MQTT is Zigbee2MQTT's application-facing transport; `zigbee-herdsman` itself is the coordinator/network library. Current `zigbee-herdsman` contains adapter implementations for `zstack`, `ember`, `deconz`, `zigate`, `zboss`, `zoh`, and deprecated `ezsp`. citeturn196029search10

The scale argument is now stronger than the user's “4,000+” figure: Zigbee2MQTT's live supported-device catalog reports **5,868 devices from 616 vendors** as crawled on November 5, 2026. citeturn196029search0

Preferred coordinator families are TI Z-Stack, Silicon Labs EmberZNet, and deCONZ; current Zigbee2MQTT documentation identifies Z-Stack/EmberZNet/deCONZ as recommended and states that coordinator firmware is required. citeturn196029search2

For Silicon Labs, current Zigbee2MQTT guidance explicitly states that multiprotocol firmware is unsupported and recommends one adapter per protocol. citeturn196029search3

Haus hardware should therefore use two radios:

```text
Radio A: Thread RCP firmware
         EFR32MG24 / nRF52840
         owned exclusively by otbr-agent

Radio B: Zigbee coordinator firmware
         EFR32MG21/MG24 EmberZNet
         or CC2652/CC1352 Z-Stack
         owned exclusively by zigbee-herdsman
```

This is preferable to running Thread and Zigbee over a single Silicon Labs multi-PAN/cpc-daemon arrangement. Home Assistant's historical multiprotocol stack still exists in source/documentation, but Zigbee2MQTT explicitly rejects multiprotocol firmware, and Home Assistant project discussion has moved toward independent radios because of reliability concerns. citeturn196029search3turn281804search6turn196029search8

### HomeKit and media library inventory

**Outbound HAP:** `@homebridge/hap-nodejs`. It provides the accessory/server model, bridges, services, characteristics, HAP pairing, camera controller, HKSV services, HDS support, television/control services, custom characteristics, mDNS publication, and setup URI generation. citeturn523657search21turn845297search1turn315338view0

**Inbound HAP in Node.js:** `hap-controller` / `hap-controller-node` for IP/BLE controller use cases. Its latest published package line is older than the other stacks, so isolate it behind an adapter interface rather than make core Haus models depend on it. citeturn104367search0turn104367search8

**Inbound HAP reference/sidecar:** `aiohomekit`, especially valuable because Home Assistant exercises it against a large real-world device population and its active repository includes CoAP/Thread-related work. citeturn104367search1turn104367search9

**Matter:** `matter.js` / Open Home Foundation Matter packages as primary TypeScript stack; `connectedhomeip` for C++/reference/certification/embedded needs. citeturn725562search0turn725562search4

**Thread:** `openthread` plus `ot-br-posix`; use vendor RCP firmware rather than embedding Thread networking logic in Haus. citeturn488140search8turn196029search6

**Zigbee:** `zigbee-herdsman` plus `zigbee-herdsman-converters`; keep ZHA/`zigpy` as a compatibility/reference source rather than running both stacks against one coordinator. citeturn725562search8turn725562search9turn281804search0

**Camera/media gateway:** `go2rtc` is a strong default because its current pipeline supports RTSP, WebRTC, HomeKit, HLS/fMP4, MSE/fMP4, MP4, H.264/HEVC and multiple audio codecs; it can therefore act as an efficient protocol/media broker before invoking FFmpeg/GStreamer only when conversion is unavoidable. citeturn104367search4turn104367search6

**HKSV implementation reference:** Scrypted's HomeKit plugin is one of the most useful real-world open implementations to study for camera publication, HKSV, accessory isolation, codec configuration, and newer HKSV behavior. citeturn104367search3turn104367search5

**MediaMTX:** use when the dominant problem is robust RTSP/WebRTC/HLS media routing and recording rather than HomeKit-specific behavior. Haus should keep its media service behind an IPC/gRPC boundary so `go2rtc`, MediaMTX, GStreamer, FFmpeg, and hardware-specific zero-copy pipelines can be substituted independently.

### Hub versus client responsibility

| Capability | Haus Hub | Mobile/Desktop Client |
|---|---|---|
| Canonical Device→Service→Characteristic database | **Required** | Cached projection |
| Home Assistant websocket/API connection | **Required** | No |
| HAP IP controller | **Required** | Optional discovery helper |
| HAP outbound accessory/bridge servers | **Required** | No |
| Stable HAP identity/PIN/setup ID | **Required** | Display only |
| `X-HM://` generation | **Authoritative** | QR rendering/scanning |
| Matter fabric/controller keys | **Required** | OS-assisted commissioning bridge |
| Matter CASE sessions | **Required** | Only OS/framework session where required for commissioning |
| Matter Multi-Admin `OpenCommissioningWindow` | **Required** | Display/pass payload into ecosystem UI |
| Matter `MT:` QR scanning | Parsed on Hub if received | **Required UX location** |
| BLE discovery during ecosystem commissioning | Optional Linux BLE | **Prefer client OS APIs** |
| Thread Border Router | **Required** | No |
| OpenThread Active Operational Dataset storage | **Required, encrypted** | OS credential broker |
| Apple ThreadNetwork credential retrieval/storage | No | **Required on Apple client** |
| Google ThreadNetworkClient credential retrieval/storage | No | **Required on Android client** |
| Zigbee coordinator | **Required** | No |
| Zigbee firmware flashing | **Required privileged service** | Initiates operation/UI |
| mDNS advertisement/reflection | **Required** | Normal OS discovery only |
| RTSP ingestion | **Required** | No |
| WebRTC/SRTP/HKSV media server | **Required** | Playback endpoint |
| HKSV prebuffer/fMP4 fragmenting | **Required** | No |
| HomeKit room/home synchronization through Apple APIs | No | **Client-side entitlement/API** |
| Camera decryption keys intended to remain user-local | Encrypted envelope only where zero-trust design requires | **Client keychain/secure enclave boundary** |
| Plugin execution | **Required sandbox** | UI extensions only |
| User approval/biometric prompts | Cannot substitute for OS | **Required where OS mandates consent** |
| Firmware/update orchestration | **Required** | UI/authorization |
| Audit log | **Required** | Read/query UI |

Apple's MatterSupport framework deliberately keeps user permission and network provisioning in the iOS commissioning experience, including provisioning Wi-Fi/Thread without an application handling raw network credentials, while returning enough commissioning information for the app's Matter ecosystem to establish its fabric. citeturn408123search4

That yields a clean trust boundary:

```text
┌──────────────────────── Client trust domain ────────────────────────┐
│ Camera/QR scanning                                                  │
│ OS BLE/Matter commissioning UI                                      │
│ Apple/Google Thread credential APIs                                 │
│ Keychain / biometric authorization                                  │
│ HomeKit framework access                                            │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ mutually authenticated local channel
┌──────────────────────────────▼───────────────────────────────────────┐
│ Haus Hub                                                            │
│                                                                      │
│ Device Graph     Rule Engine      Credential Vault                   │
│ HAP Controller   HAP Publisher    Matter Controller/Aggregator       │
│ OTBR             Zigbee          Media Broker                        │
│ HA Adapter        Vendor Plugins   Audit/Event Store                  │
└──────────────────────────────────────────────────────────────────────┘
```

For plugin isolation, protocol adapters should communicate through versioned typed APIs rather than receive unrestricted access to Matter fabric keys, HAP long-term keys, Zigbee network keys, Thread network keys, or camera credentials. A dedicated credential-vault service should perform signing/decryption/session operations and release raw keys only to components that genuinely require them.

## PROMPT FOR CODE-GENERATION AGENT (SAVE TO SCHEMA.MD)

```text
SYSTEM TASK

You are implementing the canonical smart-home schema and protocol registry for the
Haus platform.

You MUST create these two files:

1. HAUS_DEVICE_ARCHITECTURE_AND_TYPES.md
2. HAUS_PROTOCOL_STACK_AND_LIBRARIES.md

You MUST NOT abbreviate, summarize, collapse, defer, or omit any registry item.

ABSOLUTE ANTI-TRUNCATION RULES

The following text is FORBIDDEN in the generated files:

// TODO
// TODO: add rest
// remaining types
// remaining entities
// remaining services
// remaining characteristics
// other services
// other characteristics
// other device classes
// and others
// and so on
// omitted for brevity
// abbreviated
// representative examples
// same as above
// continue similarly

Do not use an ellipsis as a substitute for definitions.
Do not replace explicit definitions with prose such as "include all standard types."
Do not replace line-by-line registries with a summary table.
Do not generate placeholder types.

SOURCE-OF-TRUTH RULE

For Home Assistant, use the exact Home Assistant Core version represented by the
research snapshot and extract registries directly from Core source.

For HAP, pin the exact current @homebridge/hap-nodejs metadata version used by this
research, currently generated metadata V=889, and extract the machine-readable
ServiceDefinitions.ts and CharacteristicDefinitions.ts source.

DO NOT GUESS A UUID.

Every HAP characteristic definition MUST contain the exact UUID found in the
source registry.

Every HAP service definition MUST contain the exact UUID found in the source
registry.

When the HAP source declares:
- format
- unit
- minValue
- maxValue
- minStep
- validValues
- permissions
- adminOnlyAccess
- timed-write behavior
- write-response behavior

copy those fields into the generated Haus HAP registry.

HOME ASSISTANT ENTITY DOMAINS

Hard-code all of these domains individually:

ai_task
air_quality
alarm_control_panel
assist_satellite
binary_sensor
button
calendar
camera
climate
conversation
cover
date
datetime
device_tracker
event
fan
geo_location
humidifier
image
image_processing
infrared
lawn_mower
light
lock
media_player
notify
number
radio_frequency
remote
scene
select
sensor
siren
stt
switch
text
time
todo
tts
update
vacuum
valve
wake_word
water_heater
weather

HOME ASSISTANT DEVICE CLASSES

Hard-code every BinarySensorDeviceClass individually.

Hard-code every SensorDeviceClass individually.

Hard-code every CoverDeviceClass individually.

Hard-code every MediaPlayerDeviceClass individually.

Hard-code every SwitchDeviceClass individually.

Hard-code every ButtonDeviceClass individually.

Hard-code every EventDeviceClass individually.

Hard-code every NumberDeviceClass individually.

Do not infer NumberDeviceClass at runtime from SensorDeviceClass.
Write the NumberDeviceClass registry explicitly.

HOME ASSISTANT FEATURE REGISTRIES

Write every supported-feature bit explicitly for every entity platform that
declares one.

At minimum, include exact line-by-line feature registries for:

alarm_control_panel
camera
climate
cover
fan
humidifier
lawn_mower
light
lock
media_player
remote
siren
todo
update
vacuum
valve
water_heater
weather

For alarm_control_panel explicitly include:

ARM_HOME = 1
ARM_AWAY = 2
ARM_NIGHT = 4
TRIGGER = 8
ARM_CUSTOM_BYPASS = 16
ARM_VACATION = 32

For vacuum explicitly include:

TURN_ON = 1
TURN_OFF = 2
PAUSE = 4
STOP = 8
RETURN_HOME = 16
FAN_SPEED = 32
STATUS = 128
SEND_COMMAND = 256
LOCATE = 512
CLEAN_SPOT = 1024
MAP = 2048
STATE = 4096
START = 8192
CLEAN_AREA = 16384

Preserve deprecation information for legacy bits.

For climate explicitly include:

TARGET_TEMPERATURE = 1
TARGET_TEMPERATURE_RANGE = 2
TARGET_HUMIDITY = 4
FAN_MODE = 8
PRESET_MODE = 16
SWING_MODE = 32
TURN_OFF = 128
TURN_ON = 256
SWING_HORIZONTAL_MODE = 512

Do not invent a current AUX_HEAT bit if it is absent from the pinned Core source.

For media_player explicitly include:

PAUSE = 1
SEEK = 2
VOLUME_SET = 4
VOLUME_MUTE = 8
PREVIOUS_TRACK = 16
NEXT_TRACK = 32
TURN_ON = 128
TURN_OFF = 256
PLAY_MEDIA = 512
VOLUME_STEP = 1024
SELECT_SOURCE = 2048
STOP = 4096
CLEAR_PLAYLIST = 8192
PLAY = 16384
SHUFFLE_SET = 32768
SELECT_SOUND_MODE = 65536
BROWSE_MEDIA = 131072
REPEAT_SET = 262144
GROUPING = 524288
MEDIA_ANNOUNCE = 1048576
MEDIA_ENQUEUE = 2097152
SEARCH_MEDIA = 4194304

For lock explicitly include OPEN = 1.

For cover explicitly include:

OPEN = 1
CLOSE = 2
SET_POSITION = 4
STOP = 8
OPEN_TILT = 16
CLOSE_TILT = 32
STOP_TILT = 64
SET_TILT_POSITION = 128
SPEED = 256

HAP SERVICE REGISTRY

Write definitions for every service below individually and include its exact
UUID and required/optional characteristics from the pinned HAP metadata:

AccessCode
AccessControl
AccessoryInformation
AccessoryMetrics
AccessoryRuntimeInformation
AirPurifier
AirQualitySensor
AssetUpdate
Assistant
AudioStreamManagement
Battery
CameraOperatingMode
CameraRecordingManagement
CameraRTPStreamManagement
CarbonDioxideSensor
CarbonMonoxideSensor
CloudRelay
ContactSensor
DataStreamTransportManagement
Diagnostics
Door
Doorbell
Fan
Fanv2
Faucet
FilterMaintenance
FirmwareUpdate
GarageDoorOpener
HeaterCooler
HumidifierDehumidifier
HumiditySensor
InputSource
IrrigationSystem
LeakSensor
Lightbulb
LightSensor
LockManagement
LockMechanism
Microphone
MotionSensor
NFCAccess
OccupancySensor
Outlet
Pairing
PowerManagement
ProtocolInformation
SecuritySystem
ServiceLabel
Siri
SiriEndpoint
Slats
SmartSpeaker
SmokeSensor
Speaker
StatefulProgrammableSwitch
StatelessProgrammableSwitch
Switch
TapManagement
TargetControl
TargetControlManagement
Television
TelevisionSpeaker
TemperatureSensor
Thermostat
ThreadTransport
TransferTransportManagement
Tunnel
Valve
WiFiRouter
WiFiSatellite
WiFiTransport
Window
WindowCovering

Preserve deprecated/removed metadata for CloudRelay, TapManagement, Tunnel,
and every other source item marked deprecated.

HAP CHARACTERISTIC REGISTRY

Write a complete explicit definition for every characteristic below.
For EACH characteristic, copy its exact UUID and all metadata from
CharacteristicDefinitions.ts.

AccessCodeControlPoint
AccessCodeSupportedConfiguration
AccessControlLevel
AccessoryFlags
AccessoryIdentifier
Active
ActiveIdentifier
ActivityInterval
AdministratorOnlyAccess
AirParticulateDensity
AirParticulateSize
AirPlayEnable
AirQuality
AppMatchingIdentifier
AssetUpdateReadiness
AudioFeedback
BatteryLevel
Brightness
ButtonEvent
CameraOperatingModeIndicator
CarbonDioxideDetected
CarbonDioxideLevel
CarbonDioxidePeakLevel
CarbonMonoxideDetected
CarbonMonoxideLevel
CarbonMonoxidePeakLevel
CCAEnergyDetectThreshold
CCASignalDetectThreshold
CharacteristicValueActiveTransitionCount
CharacteristicValueTransitionControl
ChargingState
ClosedCaptions
ColorTemperature
ConfigurationState
ConfiguredName
ConnectionHealthMonitor
ContactSensorState
CoolingThresholdTemperature
CryptoHash
CurrentAirPurifierState
CurrentAmbientLightLevel
CurrentDoorState
CurrentFanState
CurrentHeaterCoolerState
CurrentHeatingCoolingState
CurrentHorizontalTiltAngle
CurrentHumidifierDehumidifierState
CurrentMediaState
CurrentPosition
CurrentRelativeHumidity
CurrentSlatState
CurrentTemperature
CurrentTiltAngle
CurrentTransport
CurrentVerticalTiltAngle
CurrentVisibilityState
DataStreamHAPTransport
DataStreamHAPTransportInterrupt
DiagonalFieldOfView
DigitalZoom
DisplayOrder
EventRetransmissionMaximum
EventSnapshotsActive
EventTransmissionCounters
FilterChangeIndication
FilterLifeLevel
FirmwareRevision
FirmwareUpdateProtocolList
FirmwareUpdateReadiness
FirmwareUpdateStatus
HardwareFinish
HardwareRevision
HeartBeat
HeatingThresholdTemperature
HoldPosition
HomeKitCameraActive
Hue
Identifier
Identify
ImageMirroring
ImageRotation
InputDeviceType
InputSourceType
InUse
IsConfigured
LeakDetected
ListPairings
LockControlPoint
LockCurrentState
LockLastKnownAction
LockManagementAutoSecurityTimeout
LockPhysicalControls
LockTargetState
Logs
MACRetransmissionMaximum
MACTransmissionCounters
ManagedNetworkEnable
ManuallyDisabled
Manufacturer
MatterFirmwareRevisionNumber
MatterFirmwareUpdateStatus
MaximumTransmitPower
MediaAccessControlLevel
MetricsBufferFullState
Model
MotionDetected
MultifunctionButton
Mute
Name
NetworkAccessViolationControl
NetworkClientProfileControl
NetworkClientStatusControl
NFCAccessControlPoint
NFCAccessSupportedConfiguration
NightVision
NitrogenDioxideDensity
ObstructionDetected
OccupancyDetected
On
OperatingStateResponse
OpticalZoom
OutletInUse
OzoneDensity
PairingFeatures
PairSetup
PairVerify
PasswordSetting
PeriodicSnapshotsActive
PictureMode
Ping
PM10Density
PM2_5Density
PositionState
PowerModeSelection
PreferredWiFiList
ProductData
ProgrammableSwitchEvent
ProgrammableSwitchOutputState
ProgramMode
ReceivedSignalStrengthIndication
ReceiverSensitivity
RecordingAudioActive
RelativeHumidityDehumidifierThreshold
RelativeHumidityHumidifierThreshold
RelayControlPoint
RelayEnabled
RelayState
RemainingDuration
RemoteKey
ResetFilterIndication
RotationDirection
RotationSpeed
RouterStatus
Saturation
SecuritySystemAlarmType
SecuritySystemCurrentState
SecuritySystemTargetState
SelectedAudioStreamConfiguration
SelectedCameraRecordingConfiguration
SelectedDiagnosticsModes
SelectedRTPStreamConfiguration
SelectedSessionKeepaliveConfigurationList
SelectedSleepConfiguration
SerialNumber
ServiceLabelIndex
ServiceLabelNamespace
SetDuration
SetupDataStreamTransport
SetupEndpoints
SetupTransferTransport
SignalToNoiseRatio
SiriEnable
SiriEndpointSessionStatus
SiriEngineVersion
SiriInputType
SiriLightOnUse
SiriListening
SiriTouchToUse
SlatType
SleepDiscoveryMode
SleepInterval
SmokeDetected
SoftwareRevision
StagedFirmwareVersion
StatusActive
StatusFault
StatusJammed
StatusLowBattery
StatusTampered
StreamingStatus
SulphurDioxideDensity
SupportedAssetTypes
SupportedAudioRecordingConfiguration
SupportedAudioStreamConfiguration
SupportedCameraRecordingConfiguration
SupportedCharacteristicValueTransitionConfiguration
SupportedDataStreamTransportConfiguration
SupportedDiagnosticsModes
SupportedDiagnosticsSnapshot
SupportedFirmwareUpdateConfiguration
SupportedMetrics
SupportedRouterConfiguration
SupportedRTPConfiguration
SupportedSessionKeepaliveConfigurationList
SupportedSleepConfiguration
SupportedTransferTransportConfiguration
SupportedVideoRecordingConfiguration
SupportedVideoStreamConfiguration
SwingMode
TapType
TargetAirPurifierState
TargetControlList
TargetControlSupportedConfiguration
TargetDoorState
TargetFanState
TargetHeaterCoolerState
TargetHeatingCoolingState
TargetHorizontalTiltAngle
TargetHumidifierDehumidifierState
TargetMediaState
TargetPosition
TargetRelativeHumidity
TargetTemperature
TargetTiltAngle
TargetVerticalTiltAngle
TargetVisibilityState
TemperatureDisplayUnits
ThirdPartyCameraActive
ThreadControlPoint
ThreadNodeCapabilities
ThreadOpenThreadVersion
ThreadStatus
Token
TransmitPower
TunnelConnectionTimeout
TunneledAccessoryAdvertising
TunneledAccessoryConnected
TunneledAccessoryStateNumber
ValveType
Version
VideoAnalysisActive
VOCDensity
Volume
VolumeControlType
VolumeSelector
WakeConfiguration
WANConfigurationList
WANStatusList
WaterLevel
WiFiCapabilities
WiFiConfigurationControl
WiFiSatelliteStatus

GENERIC HAUS TYPES

Implement and document these types individually:

GenericBoolean
GenericInt
GenericFloat
GenericEnum
GenericString
GenericAction
GenericJSONBlob

Every Generic type MUST preserve:

source protocol
source device identity
source service identity when present
source characteristic/entity/attribute identity
read permission
write permission
notification capability
unit
minimum
maximum
step
valid values
raw metadata
last-update timestamp
availability
raw value

DEVICE GRAPH

Define:

HausDevice
HausService
HausCharacteristic
SourceBinding
SourceDeviceRef
SourceServiceRef
SourceCharacteristicRef
DeviceRelationship
Availability
ProtocolDescriptor

Define stable-ID algorithms.

Define Home Assistant grouping by device_id.

Define synthetic-device behavior for entities without a device_id.

Define linked-service relationships.

Define bridge-child relationships separately from linked services.

Do not use UI naming heuristics as an automatic identity merger.

HOMEKIT PASSTHROUGH

Document and implement data structures for:

raw /accessories graph
AID
IID
service UUID
characteristic UUID
permissions
format
unit
minValue
maxValue
minStep
maxLen
maxDataLen
validValues
validValuesRange
linked services
primary flag
hidden flag
TLV8 opaque values
event subscription state

Explicitly state that Haus terminates separate HAP security sessions and is a
semantic proxy rather than a cryptographically transparent proxy.

Maintain a persistent mapping from upstream AID/IID identity to downstream
AID/IID identity.

HOMEKIT SETUP URI

Implement a tested X-HM:// encoder equivalent to HAP-NodeJS.

The encoder MUST:

remove hyphens from the eight-digit PIN
parse the resulting decimal PIN
pack the accessory category
set the Supports-IP flag
convert the packed value to uppercase base-36
pad the encoded part to exactly nine characters
append the four-character setup ID
prefix X-HM://

Add golden-vector tests against @homebridge/hap-nodejs.

MATTER

Use matter.js as the default Haus TypeScript Matter stack.

Document connectedhomeip as the C++ reference/embedded/certification stack.

Do not architect new Haus development around the deprecated final
python-matter-server line.

Define both:

MatterControllerAdapter
MatterAggregatorAdapter

Define endpoint mappings for non-Matter Haus devices.

Include Robot Vacuum Cleaner support with:

RVC Run Mode
RVC Clean Mode
RVC Operational State
Service Area when supported by the selected Matter specification revision

MATTER MULTI-ADMIN

Write the full Enhanced Commissioning Method sequence explicitly:

existing CASE session
user authorization
Administrator Commissioning OpenCommissioningWindow
temporary discriminator
temporary commissioning verifier/passcode
commissioning discovery
PASE
fail-safe
device attestation
CSR
trusted root installation
NOC installation
fabric insertion
ACL installation
operational discovery
CASE on new fabric
CommissioningComplete
commissioning-window closure

Document QR payload handling and manual 11/21-digit pairing-code handling.

THREAD

Document:

OpenThread
ot-br-posix
otbr-agent
Spinel
RCP mode
wpan0
backbone interface
IPv6 routing
on-mesh prefixes
off-mesh routes
SLAAC/RA behavior
SRP
mDNS discovery
TREL
NAT64 when enabled
firewall policy
Active Operational Dataset

Define an encrypted ThreadCredentialVault.

Define import/export of the raw Active Operational Dataset.

CLIENT THREAD APIs

Document Apple ThreadNetwork framework usage.

Document the required Apple entitlement and user-consent boundary.

Document Google Play Services ThreadNetworkClient usage.

Raw Thread credentials MUST NOT transit a cloud service.

ZIGBEE

Use:

zigbee-herdsman
zigbee-herdsman-converters

Document these adapter families explicitly:

zstack
ember
deconz
zigate
zboss
zoh
ezsp as deprecated

Document coordinator firmware lifecycle and backup/restore behavior.

Document ZHA reference architecture using:

zigpy
bellows
zigpy-znp
zigpy-deconz
zha-device-handlers

Do not require MQTT internally when embedding zigbee-herdsman.

HARDWARE REQUIREMENT

Default Haus appliance hardware MUST use distinct radios for Zigbee and Thread.

Do not design the baseline production appliance around a single-radio
Zigbee+Thread multiprotocol setup.

MEDIA

Document:

go2rtc
MediaMTX
FFmpeg
GStreamer
Scrypted HomeKit/HKSV implementation as reference

Define a MediaBroker interface supporting:

RTSP input
RTSP output
WebRTC
SRTP
HAP camera live streaming
HKSV prebuffer
fragmented MP4
CMAF where required by newer transport profiles
snapshot extraction
two-way audio
encoded-frame passthrough
hardware transcoding fallback

Do not decode/re-encode video when source and destination codec profiles are
compatible.

RESPONSIBILITY SPLIT

Mark each capability explicitly as HUB, CLIENT, or SHARED.

At minimum classify:

BLE commissioning scan
Matter QR scan
HomeKit QR scan
Apple Thread credential APIs
Android Thread credential APIs
OS permission dialogs
HomeKit framework access
Matter controller fabric
CASE session management
OpenCommissioningWindow
OTBR
Thread dataset persistence
Zigbee coordinator
mDNS advertisement
HAP server
HAP controller
RTSP/WebRTC server
HKSV prebuffer
plugin sandbox
credential vault
audit log
firmware flashing

VALIDATION

At the end of generation, add automated registry-count assertions.

Assert that the Home Assistant domain count equals the pinned source count.

Assert that every HAP Service class in ServiceDefinitions.ts has exactly one
generated Haus service registry entry.

Assert that every HAP Characteristic class in CharacteristicDefinitions.ts has
exactly one generated Haus characteristic registry entry.

Fail generation if a source item exists without a generated entry.

Fail generation if an unknown UUID is silently dropped.

Fail generation if a source enum member is silently dropped.

Fail generation if a supported-feature bit is silently dropped.

The generated markdown files are specifications, not summaries.
Every registry item must appear explicitly.
```