# Haus Device Architecture and Canonical Types

## 1. Universal Smart-Home Device Graph

Haus implements a protocol-neutral 3-tier hierarchy:

```text
Physical / Remote Endpoint
        │
        ▼
   HausDevice
   ├── HausService
   │     ├── HausCharacteristic
   │     ├── HausCharacteristic
   │     └── HausCharacteristic
   ├── HausService
   │     └── HausCharacteristic
   └── SourceDeviceRef[]
```

### 1.1 Core Entities

- **HausDevice**: Identity, lifecycle, and hardware boundary.
- **HausService**: Coherent capability or functional sub-device boundary.
- **HausCharacteristic**: Smallest typed observable and controllable state unit.
- **GenericCharacteristic Family**: First-class polymorphic extensibility preserving unconsumed properties (`generic.boolean`, `generic.int`, `generic.float`, `generic.enum`, `generic.string`, `generic.action`, `generic.json`).

## 2. Home Assistant Generated Platform Registry (45 Domains)

Every platform from the pinned Home Assistant Core platform registry:

1. `ai_task` 2. `air_quality` 3. `alarm_control_panel` 4. `assist_satellite` 5. `binary_sensor` 6. `button` 7. `calendar` 8. `camera` 9. `climate` 10. `conversation` 11. `cover` 12. `date` 13. `datetime` 14. `device_tracker` 15. `event` 16. `fan` 17. `geo_location` 18. `humidifier` 19. `image` 20. `image_processing` 21. `infrared` 22. `lawn_mower` 23. `light` 24. `lock` 25. `media_player` 26. `notify` 27. `number` 28. `radio_frequency` 29. `remote` 30. `scene` 31. `select` 32. `sensor` 33. `siren` 34. `stt` 35. `switch` 36. `text` 37. `time` 38. `todo` 39. `tts` 40. `update` 41. `vacuum` 42. `valve` 43. `wake_word` 44. `water_heater` 45. `weather`

## 3. Home Assistant Device Class Registries

### 3.1 BinarySensorDeviceClass (29 classes)

`battery`, `battery_charging`, `carbon_monoxide`, `cold`, `connectivity`, `door`, `garage_door`, `gas`, `glass_break`, `heat`, `light`, `lock`, `moisture`, `motion`, `moving`, `occupancy`, `opening`, `plug`, `power`, `presence`, `problem`, `running`, `safety`, `smoke`, `sound`, `tamper`, `update`, `vibration`, `window`.

### 3.2 CoverDeviceClass (10 classes)

`awning`, `blind`, `curtain`, `damper`, `door`, `garage`, `gate`, `shade`, `shutter`, `window`.

### 3.3 MediaPlayerDeviceClass (4 classes)

`tv`, `speaker`, `receiver`, `projector`.

### 3.4 SwitchDeviceClass (2 classes)

`outlet`, `switch`.

### 3.5 ButtonDeviceClass (3 classes)

`identify`, `restart`, `update`.

### 3.6 EventDeviceClass (3 classes)

`doorbell`, `button`, `motion`.

### 3.7 SensorDeviceClass (62 classes)

`date`, `enum`, `timestamp`, `uptime`, `absolute_humidity`, `apparent_power`, `aqi`, `area`, `atmospheric_pressure`, `battery`, `blood_glucose_concentration`, `carbon_monoxide`, `carbon_dioxide`, `conductivity`, `current`, `data_rate`, `data_size`, `distance`, `duration`, `energy`, `energy_distance`, `energy_storage`, `frequency`, `gas`, `humidity`, `illuminance`, `irradiance`, `moisture`, `monetary`, `nitrogen_dioxide`, `nitrogen_monoxide`, `nitrous_oxide`, `ozone`, `ph`, `pm1`, `pm10`, `pm25`, `pm4`, `power_factor`, `power`, `precipitation`, `precipitation_intensity`, `pressure`, `radon`, `reactive_energy`, `reactive_power`, `signal_strength`, `sound_pressure`, `speed`, `sulphur_dioxide`, `temperature`, `temperature_delta`, `volatile_organic_compounds`, `volatile_organic_compounds_parts`, `voltage`, `volume`, `volume_storage`, `volume_flow_rate`, `water`, `weight`, `wind_direction`, `wind_speed`.

### 3.8 NumberDeviceClass (58 classes)

`absolute_humidity`, `apparent_power`, `aqi`, `area`, `atmospheric_pressure`, `battery`, `blood_glucose_concentration`, `carbon_monoxide`, `carbon_dioxide`, `conductivity`, `current`, `data_rate`, `data_size`, `distance`, `duration`, `energy`, `energy_distance`, `energy_storage`, `frequency`, `gas`, `humidity`, `illuminance`, `irradiance`, `moisture`, `monetary`, `nitrogen_dioxide`, `nitrogen_monoxide`, `nitrous_oxide`, `ozone`, `ph`, `pm1`, `pm10`, `pm25`, `pm4`, `power_factor`, `power`, `precipitation`, `precipitation_intensity`, `pressure`, `radon`, `reactive_energy`, `reactive_power`, `signal_strength`, `sound_pressure`, `speed`, `sulphur_dioxide`, `temperature`, `temperature_delta`, `volatile_organic_compounds`, `volatile_organic_compounds_parts`, `voltage`, `volume`, `volume_storage`, `volume_flow_rate`, `water`, `weight`, `wind_direction`, `wind_speed`.

## 4. Complex Feature Registries (18 Platforms)

- **AlarmControlPanel**: `ARM_HOME=1`, `ARM_AWAY=2`, `ARM_NIGHT=4`, `TRIGGER=8`, `ARM_CUSTOM_BYPASS=16`, `ARM_VACATION=32`.
- **Camera**: `ON_OFF=1`, `STREAM=2`.
- **Climate**: `TARGET_TEMPERATURE=1`, `TARGET_TEMPERATURE_RANGE=2`, `TARGET_HUMIDITY=4`, `FAN_MODE=8`, `PRESET_MODE=16`, `SWING_MODE=32`, `TURN_OFF=128`, `TURN_ON=256`, `SWING_HORIZONTAL_MODE=512`.
- **Cover**: `OPEN=1`, `CLOSE=2`, `SET_POSITION=4`, `STOP=8`, `OPEN_TILT=16`, `CLOSE_TILT=32`, `STOP_TILT=64`, `SET_TILT_POSITION=128`, `SPEED=256`.
- **Fan**: `SET_SPEED=1`, `OSCILLATE=2`, `DIRECTION=4`, `PRESET_MODE=8`, `TURN_OFF=16`, `TURN_ON=32`.
- **Humidifier**: `MODES=1`.
- **LawnMower**: `START_MOWING=1`, `PAUSE=2`, `STOP=4`, `DOCK=8`.
- **Light**: `EFFECT=4`, `FLASH=8`, `TRANSITION=32`.
- **Lock**: `OPEN=1`.
- **MediaPlayer**: `PAUSE=1`, `SEEK=2`, `VOLUME_SET=4`, `VOLUME_MUTE=8`, `PREVIOUS_TRACK=16`, `NEXT_TRACK=32`, `TURN_ON=128`, `TURN_OFF=256`, `PLAY_MEDIA=512`, `VOLUME_STEP=1024`, `SELECT_SOURCE=2048`, `STOP=4096`, `CLEAR_PLAYLIST=8192`, `PLAY=16384`, `SHUFFLE_SET=32768`, `SELECT_SOUND_MODE=65536`, `BROWSE_MEDIA=131072`, `REPEAT_SET=262144`, `GROUPING=524288`, `MEDIA_ANNOUNCE=1048576`, `MEDIA_ENQUEUE=2097152`, `SEARCH_MEDIA=4194304`.
- **Remote**: `LEARN_COMMAND=1`, `DELETE_COMMAND=2`, `ACTIVITY=4`.
- **Siren**: `TURN_ON=1`, `TURN_OFF=2`, `TONES=4`, `VOLUME_SET=8`, `DURATION=16`.
- **Todo**: `SUPPORT_MOVE=1`.
- **Update**: `INSTALL=1`, `SPECIFIC_VERSION=2`, `PROGRESS=4`, `BACKUP=8`, `RELEASE_NOTES=16`.
- **Vacuum**: `TURN_ON=1` (deprecated), `TURN_OFF=2` (deprecated), `PAUSE=4`, `STOP=8`, `RETURN_HOME=16`, `FAN_SPEED=32`, `STATUS=128` (deprecated), `SEND_COMMAND=256`, `LOCATE=512`, `CLEAN_SPOT=1024`, `MAP=2048`, `STATE=4096`, `START=8192`, `CLEAN_AREA=16384`.
- **Valve**: `OPEN=1`, `CLOSE=2`, `SET_POSITION=4`, `STOP=8`.
- **WaterHeater**: `TARGET_TEMPERATURE=1`, `OPERATION_MODE=2`, `AWAY_MODE=4`.
- **Weather**: `FORECAST_DAILY=1`, `FORECAST_HOURLY=2`, `FORECAST_TWICE_DAILY=4`.

## 5. HomeKit Complete Service Registry (73 Services)

| Service Class                 | Canonical UUID                         | Deprecated |
| ----------------------------- | -------------------------------------- | ---------- |
| AccessCode                    | `00000260-0000-1000-8000-0026BB765291` | No         |
| AccessControl                 | `000000DA-0000-1000-8000-0026BB765291` | No         |
| AccessoryInformation          | `0000003E-0000-1000-8000-0026BB765291` | No         |
| AccessoryMetrics              | `00000270-0000-1000-8000-0026BB765291` | No         |
| AccessoryRuntimeInformation   | `00000239-0000-1000-8000-0026BB765291` | No         |
| AirPurifier                   | `000000BB-0000-1000-8000-0026BB765291` | No         |
| AirQualitySensor              | `0000008D-0000-1000-8000-0026BB765291` | No         |
| AssetUpdate                   | `00000267-0000-1000-8000-0026BB765291` | No         |
| Assistant                     | `0000026A-0000-1000-8000-0026BB765291` | No         |
| AudioStreamManagement         | `00000127-0000-1000-8000-0026BB765291` | No         |
| Battery                       | `00000096-0000-1000-8000-0026BB765291` | No         |
| CameraOperatingMode           | `0000021A-0000-1000-8000-0026BB765291` | No         |
| CameraRecordingManagement     | `00000204-0000-1000-8000-0026BB765291` | No         |
| CameraRTPStreamManagement     | `00000110-0000-1000-8000-0026BB765291` | No         |
| CarbonDioxideSensor           | `00000097-0000-1000-8000-0026BB765291` | No         |
| CarbonMonoxideSensor          | `0000007F-0000-1000-8000-0026BB765291` | No         |
| CloudRelay                    | `0000005A-0000-1000-8000-0026BB765291` | Yes        |
| ContactSensor                 | `00000080-0000-1000-8000-0026BB765291` | No         |
| DataStreamTransportManagement | `00000129-0000-1000-8000-0026BB765291` | No         |
| Diagnostics                   | `00000237-0000-1000-8000-0026BB765291` | No         |
| Door                          | `00000081-0000-1000-8000-0026BB765291` | No         |
| Doorbell                      | `00000121-0000-1000-8000-0026BB765291` | No         |
| Fan                           | `00000040-0000-1000-8000-0026BB765291` | No         |
| Fanv2                         | `000000B7-0000-1000-8000-0026BB765291` | No         |
| Faucet                        | `000000D7-0000-1000-8000-0026BB765291` | No         |
| FilterMaintenance             | `000000BA-0000-1000-8000-0026BB765291` | No         |
| FirmwareUpdate                | `00000236-0000-1000-8000-0026BB765291` | No         |
| GarageDoorOpener              | `00000041-0000-1000-8000-0026BB765291` | No         |
| HeaterCooler                  | `000000BC-0000-1000-8000-0026BB765291` | No         |
| HumidifierDehumidifier        | `000000BD-0000-1000-8000-0026BB765291` | No         |
| HumiditySensor                | `00000082-0000-1000-8000-0026BB765291` | No         |
| InputSource                   | `000000D9-0000-1000-8000-0026BB765291` | No         |
| IrrigationSystem              | `000000CF-0000-1000-8000-0026BB765291` | No         |
| LeakSensor                    | `00000083-0000-1000-8000-0026BB765291` | No         |
| Lightbulb                     | `00000043-0000-1000-8000-0026BB765291` | No         |
| LightSensor                   | `00000084-0000-1000-8000-0026BB765291` | No         |
| LockManagement                | `00000044-0000-1000-8000-0026BB765291` | No         |
| LockMechanism                 | `00000045-0000-1000-8000-0026BB765291` | No         |
| Microphone                    | `00000112-0000-1000-8000-0026BB765291` | No         |
| MotionSensor                  | `00000085-0000-1000-8000-0026BB765291` | No         |
| NFCAccess                     | `00000266-0000-1000-8000-0026BB765291` | No         |
| OccupancySensor               | `00000086-0000-1000-8000-0026BB765291` | No         |
| Outlet                        | `00000047-0000-1000-8000-0026BB765291` | No         |
| Pairing                       | `00000055-0000-1000-8000-0026BB765291` | No         |
| PowerManagement               | `00000221-0000-1000-8000-0026BB765291` | No         |
| ProtocolInformation           | `000000A2-0000-1000-8000-0026BB765291` | No         |
| SecuritySystem                | `0000007E-0000-1000-8000-0026BB765291` | No         |
| ServiceLabel                  | `000000CC-0000-1000-8000-0026BB765291` | No         |
| Siri                          | `00000133-0000-1000-8000-0026BB765291` | No         |
| SiriEndpoint                  | `00000253-0000-1000-8000-0026BB765291` | No         |
| Slats                         | `000000B9-0000-1000-8000-0026BB765291` | No         |
| SmartSpeaker                  | `00000228-0000-1000-8000-0026BB765291` | No         |
| SmokeSensor                   | `00000087-0000-1000-8000-0026BB765291` | No         |
| Speaker                       | `00000113-0000-1000-8000-0026BB765291` | No         |
| StatefulProgrammableSwitch    | `00000088-0000-1000-8000-0026BB765291` | No         |
| StatelessProgrammableSwitch   | `00000089-0000-1000-8000-0026BB765291` | No         |
| Switch                        | `00000049-0000-1000-8000-0026BB765291` | No         |
| TapManagement                 | `0000022E-0000-1000-8000-0026BB765291` | Yes        |
| TargetControl                 | `00000125-0000-1000-8000-0026BB765291` | No         |
| TargetControlManagement       | `00000122-0000-1000-8000-0026BB765291` | No         |
| Television                    | `000000D8-0000-1000-8000-0026BB765291` | No         |
| TelevisionSpeaker             | `00000113-0000-1000-8000-0026BB765291` | No         |
| TemperatureSensor             | `0000008A-0000-1000-8000-0026BB765291` | No         |
| Thermostat                    | `0000004A-0000-1000-8000-0026BB765291` | No         |
| ThreadTransport               | `00000701-0000-1000-8000-0026BB765291` | No         |
| TransferTransportManagement   | `00000203-0000-1000-8000-0026BB765291` | No         |
| Tunnel                        | `00000056-0000-1000-8000-0026BB765291` | Yes        |
| Valve                         | `000000D0-0000-1000-8000-0026BB765291` | No         |
| WiFiRouter                    | `0000020A-0000-1000-8000-0026BB765291` | No         |
| WiFiSatellite                 | `0000020F-0000-1000-8000-0026BB765291` | No         |
| WiFiTransport                 | `0000022A-0000-1000-8000-0026BB765291` | No         |
| Window                        | `0000008B-0000-1000-8000-0026BB765291` | No         |
| WindowCovering                | `0000008C-0000-1000-8000-0026BB765291` | No         |

## 6. HomeKit Complete Characteristic Registry (252 Characteristics)

| Characteristic                                      | UUID                                   | Format | Permissions    |
| --------------------------------------------------- | -------------------------------------- | ------ | -------------- |
| AccessCodeControlPoint                              | `00000262-0000-1000-8000-0026BB765291` | tlv8   | pr,pw,wr       |
| AccessCodeSupportedConfiguration                    | `00000261-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| AccessControlLevel                                  | `000000E5-0000-1000-8000-0026BB765291` | uint16 | ev,pr,pw       |
| AccessoryFlags                                      | `000000A6-0000-1000-8000-0026BB765291` | uint32 | ev,pr          |
| AccessoryIdentifier                                 | `00000057-0000-1000-8000-0026BB765291` | string | pr             |
| Active                                              | `000000B0-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| ActiveIdentifier                                    | `000000E7-0000-1000-8000-0026BB765291` | uint32 | ev,pr,pw       |
| ActivityInterval                                    | `0000023B-0000-1000-8000-0026BB765291` | uint32 | ev,pr          |
| AdministratorOnlyAccess                             | `00000001-0000-1000-8000-0026BB765291` | bool   | ev,pr,pw       |
| AirParticulateDensity                               | `00000064-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| AirParticulateSize                                  | `00000065-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| AirPlayEnable                                       | `0000025B-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| AirQuality                                          | `00000095-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| AppMatchingIdentifier                               | `000000A4-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| AssetUpdateReadiness                                | `00000269-0000-1000-8000-0026BB765291` | uint32 | ev,pr          |
| AudioFeedback                                       | `00000005-0000-1000-8000-0026BB765291` | bool   | ev,pr,pw       |
| BatteryLevel                                        | `00000068-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| Brightness                                          | `00000008-0000-1000-8000-0026BB765291` | int    | ev,pr,pw       |
| ButtonEvent                                         | `00000126-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| CameraOperatingModeIndicator                        | `0000021D-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw,tw    |
| CarbonDioxideDetected                               | `00000092-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CarbonDioxideLevel                                  | `00000093-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| CarbonDioxidePeakLevel                              | `00000094-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| CarbonMonoxideDetected                              | `00000069-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CarbonMonoxideLevel                                 | `00000090-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| CarbonMonoxidePeakLevel                             | `00000091-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| CCAEnergyDetectThreshold                            | `00000246-0000-1000-8000-0026BB765291` | int    | pr             |
| CCASignalDetectThreshold                            | `00000245-0000-1000-8000-0026BB765291` | int    | pr             |
| CharacteristicValueActiveTransitionCount            | `0000024B-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CharacteristicValueTransitionControl                | `00000143-0000-1000-8000-0026BB765291` | tlv8   | pr,pw,wr       |
| ChargingState                                       | `0000008F-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| ClosedCaptions                                      | `000000DD-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| ColorTemperature                                    | `000000CE-0000-1000-8000-0026BB765291` | int    | ev,pr,pw       |
| ConfigurationState                                  | `00000263-0000-1000-8000-0026BB765291` | uint16 | ev,pr          |
| ConfiguredName                                      | `000000E3-0000-1000-8000-0026BB765291` | string | ev,pr,pw       |
| ConnectionHealthMonitor                             | `00000273-0000-1000-8000-0026BB765291` | tlv8   | ev,pr,pw       |
| ContactSensorState                                  | `0000006A-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CoolingThresholdTemperature                         | `0000000D-0000-1000-8000-0026BB765291` | float  | ev,pr,pw       |
| CryptoHash                                          | `00000250-0000-1000-8000-0026BB765291` | tlv8   | pw,wr          |
| CurrentAirPurifierState                             | `000000A9-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CurrentAmbientLightLevel                            | `0000006B-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| CurrentDoorState                                    | `0000000E-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CurrentFanState                                     | `000000AF-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CurrentHeaterCoolerState                            | `000000B1-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CurrentHeatingCoolingState                          | `0000000F-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CurrentHorizontalTiltAngle                          | `0000006C-0000-1000-8000-0026BB765291` | int    | ev,pr          |
| CurrentHumidifierDehumidifierState                  | `000000B3-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CurrentMediaState                                   | `000000E0-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CurrentPosition                                     | `0000006D-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CurrentRelativeHumidity                             | `00000010-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| CurrentSlatState                                    | `000000AA-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| CurrentTemperature                                  | `00000011-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| CurrentTiltAngle                                    | `000000C1-0000-1000-8000-0026BB765291` | int    | ev,pr          |
| CurrentTransport                                    | `0000022B-0000-1000-8000-0026BB765291` | bool   | pr             |
| CurrentVerticalTiltAngle                            | `0000006E-0000-1000-8000-0026BB765291` | int    | ev,pr          |
| CurrentVisibilityState                              | `00000135-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| DataStreamHAPTransport                              | `00000138-0000-1000-8000-0026BB765291` | tlv8   | pr,pw,wr       |
| DataStreamHAPTransportInterrupt                     | `00000139-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| DiagonalFieldOfView                                 | `00000224-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| DigitalZoom                                         | `0000011D-0000-1000-8000-0026BB765291` | float  | ev,pr,pw       |
| DisplayOrder                                        | `00000136-0000-1000-8000-0026BB765291` | tlv8   | ev,pr,pw       |
| EventRetransmissionMaximum                          | `0000023D-0000-1000-8000-0026BB765291` | uint8  | pr             |
| EventSnapshotsActive                                | `00000223-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| EventTransmissionCounters                           | `0000023E-0000-1000-8000-0026BB765291` | uint32 | pr             |
| FilterChangeIndication                              | `000000AC-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| FilterLifeLevel                                     | `000000AB-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| FirmwareRevision                                    | `00000052-0000-1000-8000-0026BB765291` | string | pr             |
| FirmwareUpdateProtocolList                          | `0000026F-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| FirmwareUpdateReadiness                             | `00000234-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| FirmwareUpdateStatus                                | `00000235-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| HardwareFinish                                      | `0000026C-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| HardwareRevision                                    | `00000053-0000-1000-8000-0026BB765291` | string | pr             |
| HeartBeat                                           | `0000024A-0000-1000-8000-0026BB765291` | uint32 | ev,pr          |
| HeatingThresholdTemperature                         | `00000012-0000-1000-8000-0026BB765291` | float  | ev,pr,pw       |
| HoldPosition                                        | `0000006F-0000-1000-8000-0026BB765291` | bool   | pw             |
| HomeKitCameraActive                                 | `0000021B-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| Hue                                                 | `00000013-0000-1000-8000-0026BB765291` | float  | ev,pr,pw       |
| Identifier                                          | `000000E6-0000-1000-8000-0026BB765291` | uint32 | pr             |
| Identify                                            | `00000014-0000-1000-8000-0026BB765291` | bool   | pw             |
| ImageMirroring                                      | `0000011F-0000-1000-8000-0026BB765291` | bool   | ev,pr,pw       |
| ImageRotation                                       | `0000011E-0000-1000-8000-0026BB765291` | int    | ev,pr,pw       |
| InputDeviceType                                     | `000000DC-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| InputSourceType                                     | `000000DB-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| InUse                                               | `000000D2-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| IsConfigured                                        | `000000D6-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| LeakDetected                                        | `00000070-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| ListPairings                                        | `00000050-0000-1000-8000-0026BB765291` | tlv8   | pr,pw          |
| LockControlPoint                                    | `00000019-0000-1000-8000-0026BB765291` | tlv8   | pw             |
| LockCurrentState                                    | `0000001D-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| LockLastKnownAction                                 | `0000001C-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| LockManagementAutoSecurityTimeout                   | `0000001A-0000-1000-8000-0026BB765291` | uint32 | ev,pr,pw       |
| LockPhysicalControls                                | `000000A7-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| LockTargetState                                     | `0000001E-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| Logs                                                | `0000001F-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| MACRetransmissionMaximum                            | `00000247-0000-1000-8000-0026BB765291` | uint8  | pr             |
| MACTransmissionCounters                             | `00000248-0000-1000-8000-0026BB765291` | data   | pr             |
| ManagedNetworkEnable                                | `00000215-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw,tw    |
| ManuallyDisabled                                    | `00000227-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| Manufacturer                                        | `00000020-0000-1000-8000-0026BB765291` | string | pr             |
| MatterFirmwareRevisionNumber                        | `0000026D-0000-1000-8000-0026BB765291` | uint32 | ev,pr          |
| MatterFirmwareUpdateStatus                          | `0000026E-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| MaximumTransmitPower                                | `00000243-0000-1000-8000-0026BB765291` | int    | pr             |
| MediaAccessControlLevel                             | `000000EE-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| MetricsBufferFullState                              | `00000272-0000-1000-8000-0026BB765291` | bool   | ev,pr          |
| Model                                               | `00000021-0000-1000-8000-0026BB765291` | string | pr             |
| MotionDetected                                      | `00000022-0000-1000-8000-0026BB765291` | bool   | ev,pr          |
| MultifunctionButton                                 | `0000026B-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| Mute                                                | `0000011A-0000-1000-8000-0026BB765291` | bool   | ev,pr,pw       |
| Name                                                | `00000023-0000-1000-8000-0026BB765291` | string | pr             |
| NetworkAccessViolationControl                       | `0000021F-0000-1000-8000-0026BB765291` | tlv8   | ev,pr,pw,tw,wr |
| NetworkClientProfileControl                         | `0000020C-0000-1000-8000-0026BB765291` | tlv8   | ev,pr,pw,tw,wr |
| NetworkClientStatusControl                          | `0000020D-0000-1000-8000-0026BB765291` | tlv8   | pr,pw,wr       |
| NFCAccessControlPoint                               | `00000264-0000-1000-8000-0026BB765291` | tlv8   | pr,pw,wr       |
| NFCAccessSupportedConfiguration                     | `00000265-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| NightVision                                         | `0000011B-0000-1000-8000-0026BB765291` | bool   | ev,pr,pw,tw    |
| NitrogenDioxideDensity                              | `000000C4-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| ObstructionDetected                                 | `00000024-0000-1000-8000-0026BB765291` | bool   | ev,pr          |
| OccupancyDetected                                   | `00000071-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| On                                                  | `00000025-0000-1000-8000-0026BB765291` | bool   | ev,pr,pw       |
| OperatingStateResponse                              | `00000232-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| OpticalZoom                                         | `0000011C-0000-1000-8000-0026BB765291` | float  | ev,pr,pw       |
| OutletInUse                                         | `00000026-0000-1000-8000-0026BB765291` | bool   | ev,pr          |
| OzoneDensity                                        | `000000C3-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| PairingFeatures                                     | `0000004F-0000-1000-8000-0026BB765291` | uint8  | pr             |
| PairSetup                                           | `0000004C-0000-1000-8000-0026BB765291` | tlv8   | pr,pw          |
| PairVerify                                          | `0000004E-0000-1000-8000-0026BB765291` | tlv8   | pr,pw          |
| PasswordSetting                                     | `000000E4-0000-1000-8000-0026BB765291` | tlv8   | ev,pr,pw       |
| PeriodicSnapshotsActive                             | `00000225-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| PictureMode                                         | `000000E2-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| Ping                                                | `0000023C-0000-1000-8000-0026BB765291` | data   | pr             |
| PM10Density                                         | `000000C7-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| PM2_5Density                                        | `000000C6-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| PositionState                                       | `00000072-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| PowerModeSelection                                  | `000000DF-0000-1000-8000-0026BB765291` | uint8  | pw             |
| PreferredWiFiList                                   | `0000022E-0000-1000-8000-0026BB765291` | tlv8   | ev,pr,pw       |
| ProductData                                         | `00000220-0000-1000-8000-0026BB765291` | data   | pr             |
| ProgrammableSwitchEvent                             | `00000073-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| ProgrammableSwitchOutputState                       | `00000074-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| ProgramMode                                         | `000000D1-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| ReceivedSignalStrengthIndication                    | `0000023F-0000-1000-8000-0026BB765291` | int    | pr             |
| ReceiverSensitivity                                 | `00000244-0000-1000-8000-0026BB765291` | int    | pr             |
| RecordingAudioActive                                | `00000226-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw,tw    |
| RelativeHumidityDehumidifierThreshold               | `000000C9-0000-1000-8000-0026BB765291` | float  | ev,pr,pw       |
| RelativeHumidityHumidifierThreshold                 | `000000CA-0000-1000-8000-0026BB765291` | float  | ev,pr,pw       |
| RelayControlPoint                                   | `0000005E-0000-1000-8000-0026BB765291` | tlv8   | ev,pr,pw       |
| RelayEnabled                                        | `0000005B-0000-1000-8000-0026BB765291` | bool   | ev,pr,pw       |
| RelayState                                          | `0000005C-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| RemainingDuration                                   | `000000D4-0000-1000-8000-0026BB765291` | uint32 | ev,pr          |
| RemoteKey                                           | `000000E1-0000-1000-8000-0026BB765291` | uint8  | pw             |
| ResetFilterIndication                               | `000000AD-0000-1000-8000-0026BB765291` | uint8  | pw             |
| RotationDirection                                   | `00000028-0000-1000-8000-0026BB765291` | int    | ev,pr,pw       |
| RotationSpeed                                       | `00000029-0000-1000-8000-0026BB765291` | float  | ev,pr,pw       |
| RouterStatus                                        | `0000020E-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| Saturation                                          | `0000002F-0000-1000-8000-0026BB765291` | float  | ev,pr,pw       |
| SecuritySystemAlarmType                             | `0000008E-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| SecuritySystemCurrentState                          | `00000066-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| SecuritySystemTargetState                           | `00000067-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| SelectedAudioStreamConfiguration                    | `00000128-0000-1000-8000-0026BB765291` | tlv8   | pr,pw          |
| SelectedCameraRecordingConfiguration                | `00000209-0000-1000-8000-0026BB765291` | tlv8   | ev,pr,pw       |
| SelectedDiagnosticsModes                            | `0000024D-0000-1000-8000-0026BB765291` | uint32 | pr,pw          |
| SelectedRTPStreamConfiguration                      | `00000117-0000-1000-8000-0026BB765291` | tlv8   | pr,pw          |
| SelectedSessionKeepaliveConfigurationList           | `00000275-0000-1000-8000-0026BB765291` | tlv8   | ev,pr,pw       |
| SelectedSleepConfiguration                          | `00000252-0000-1000-8000-0026BB765291` | tlv8   | ev,pr,pw,wr    |
| SerialNumber                                        | `00000030-0000-1000-8000-0026BB765291` | string | pr             |
| ServiceLabelIndex                                   | `000000CB-0000-1000-8000-0026BB765291` | uint8  | pr             |
| ServiceLabelNamespace                               | `000000CD-0000-1000-8000-0026BB765291` | uint8  | pr             |
| SetDuration                                         | `000000D3-0000-1000-8000-0026BB765291` | uint32 | ev,pr,pw       |
| SetupDataStreamTransport                            | `00000131-0000-1000-8000-0026BB765291` | tlv8   | pr,pw,wr       |
| SetupEndpoints                                      | `00000118-0000-1000-8000-0026BB765291` | tlv8   | pr,pw          |
| SetupTransferTransport                              | `00000201-0000-1000-8000-0026BB765291` | tlv8   | pw,wr          |
| SignalToNoiseRatio                                  | `00000241-0000-1000-8000-0026BB765291` | int    | pr             |
| SiriEnable                                          | `00000255-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| SiriEndpointSessionStatus                           | `00000254-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| SiriEngineVersion                                   | `0000025A-0000-1000-8000-0026BB765291` | string | pr             |
| SiriInputType                                       | `00000132-0000-1000-8000-0026BB765291` | uint8  | pr             |
| SiriLightOnUse                                      | `00000258-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| SiriListening                                       | `00000256-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| SiriTouchToUse                                      | `00000257-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| SlatType                                            | `000000C0-0000-1000-8000-0026BB765291` | uint8  | pr             |
| SleepDiscoveryMode                                  | `000000E8-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| SleepInterval                                       | `0000023A-0000-1000-8000-0026BB765291` | uint32 | ev,pr          |
| SmokeDetected                                       | `00000076-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| SoftwareRevision                                    | `00000054-0000-1000-8000-0026BB765291` | string | pr             |
| StagedFirmwareVersion                               | `00000249-0000-1000-8000-0026BB765291` | string | ev,pr          |
| StatusActive                                        | `00000075-0000-1000-8000-0026BB765291` | bool   | ev,pr          |
| StatusFault                                         | `00000077-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| StatusJammed                                        | `00000078-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| StatusLowBattery                                    | `00000079-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| StatusTampered                                      | `0000007A-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| StreamingStatus                                     | `00000120-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| SulphurDioxideDensity                               | `000000C5-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| SupportedAssetTypes                                 | `00000268-0000-1000-8000-0026BB765291` | uint32 | pr             |
| SupportedAudioRecordingConfiguration                | `00000207-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| SupportedAudioStreamConfiguration                   | `00000115-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| SupportedCameraRecordingConfiguration               | `00000205-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| SupportedCharacteristicValueTransitionConfiguration | `00000144-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| SupportedDataStreamTransportConfiguration           | `00000130-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| SupportedDiagnosticsModes                           | `0000024C-0000-1000-8000-0026BB765291` | uint32 | pr             |
| SupportedDiagnosticsSnapshot                        | `00000238-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| SupportedFirmwareUpdateConfiguration                | `00000233-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| SupportedMetrics                                    | `00000271-0000-1000-8000-0026BB765291` | tlv8   | pr,pw          |
| SupportedRouterConfiguration                        | `00000210-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| SupportedRTPConfiguration                           | `00000116-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| SupportedSessionKeepaliveConfigurationList          | `00000274-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| SupportedSleepConfiguration                         | `00000251-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| SupportedTransferTransportConfiguration             | `00000202-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| SupportedVideoRecordingConfiguration                | `00000206-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| SupportedVideoStreamConfiguration                   | `00000114-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| SwingMode                                           | `000000B6-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| TapType                                             | `0000022F-0000-1000-8000-0026BB765291` | uint16 | pr             |
| TargetAirPurifierState                              | `000000A8-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| TargetControlList                                   | `00000124-0000-1000-8000-0026BB765291` | tlv8   | pr,pw,wr       |
| TargetControlSupportedConfiguration                 | `00000123-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| TargetDoorState                                     | `00000032-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| TargetFanState                                      | `000000BF-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| TargetHeaterCoolerState                             | `000000B2-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| TargetHeatingCoolingState                           | `00000033-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| TargetHorizontalTiltAngle                           | `0000007B-0000-1000-8000-0026BB765291` | int    | ev,pr,pw       |
| TargetHumidifierDehumidifierState                   | `000000B4-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| TargetMediaState                                    | `00000137-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| TargetPosition                                      | `0000007C-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| TargetRelativeHumidity                              | `00000034-0000-1000-8000-0026BB765291` | float  | ev,pr,pw       |
| TargetTemperature                                   | `00000035-0000-1000-8000-0026BB765291` | float  | ev,pr,pw       |
| TargetTiltAngle                                     | `000000C2-0000-1000-8000-0026BB765291` | int    | ev,pr,pw       |
| TargetVerticalTiltAngle                             | `0000007D-0000-1000-8000-0026BB765291` | int    | ev,pr,pw       |
| TargetVisibilityState                               | `00000134-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| TemperatureDisplayUnits                             | `00000036-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| ThirdPartyCameraActive                              | `0000021C-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| ThreadControlPoint                                  | `00000704-0000-1000-8000-0026BB765291` | tlv8   | pw             |
| ThreadNodeCapabilities                              | `00000702-0000-1000-8000-0026BB765291` | uint16 | pr             |
| ThreadOpenThreadVersion                             | `00000706-0000-1000-8000-0026BB765291` | string | pr             |
| ThreadStatus                                        | `00000703-0000-1000-8000-0026BB765291` | uint16 | ev,pr          |
| Token                                               | `00000231-0000-1000-8000-0026BB765291` | data   | pw             |
| TransmitPower                                       | `00000242-0000-1000-8000-0026BB765291` | int    | pr             |
| TunnelConnectionTimeout                             | `00000061-0000-1000-8000-0026BB765291` | int    | ev,pr,pw       |
| TunneledAccessoryAdvertising                        | `00000060-0000-1000-8000-0026BB765291` | bool   | ev,pr,pw       |
| TunneledAccessoryConnected                          | `00000059-0000-1000-8000-0026BB765291` | bool   | ev,pr,pw       |
| TunneledAccessoryStateNumber                        | `00000058-0000-1000-8000-0026BB765291` | int    | ev,pr          |
| ValveType                                           | `000000D5-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| Version                                             | `00000037-0000-1000-8000-0026BB765291` | string | pr             |
| VideoAnalysisActive                                 | `00000229-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| VOCDensity                                          | `000000C8-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| Volume                                              | `00000119-0000-1000-8000-0026BB765291` | uint8  | ev,pr,pw       |
| VolumeControlType                                   | `000000E9-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |
| VolumeSelector                                      | `000000EA-0000-1000-8000-0026BB765291` | uint8  | pw             |
| WakeConfiguration                                   | `00000222-0000-1000-8000-0026BB765291` | tlv8   | pr             |
| WANConfigurationList                                | `00000211-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| WANStatusList                                       | `00000212-0000-1000-8000-0026BB765291` | tlv8   | ev,pr          |
| WaterLevel                                          | `000000B5-0000-1000-8000-0026BB765291` | float  | ev,pr          |
| WiFiCapabilities                                    | `0000022C-0000-1000-8000-0026BB765291` | uint32 | pr             |
| WiFiConfigurationControl                            | `0000022D-0000-1000-8000-0026BB765291` | tlv8   | ev,pr,pw,tw,wr |
| WiFiSatelliteStatus                                 | `0000021E-0000-1000-8000-0026BB765291` | uint8  | ev,pr          |

## 7. Deterministic Entity Grouping Algorithm

```text
resolveEntity(entity):
    sourceDevice = HA device_registry entry
    if sourceDevice.device_id exists:
        hausDeviceKey = "ha:device:" + configEntryId + ":" + device_id
    else:
        hausDeviceKey = "ha:entity:" + entityRegistryId

    classify entity domain / device_class
    attach core state as primary characteristic
    attach standardized attributes as typed characteristics
    attach unconsumed attributes as Generic characteristics
    persist source entity ID and registry identity
```

Anti-heuristic guarantee: entities without a `device_id` are never merged based on string similarity.

## 8. Security System 16-State Machine & HomeKit Policy Table

Rich internal states: `DISARMED`, `ARMING_HOME`, `ARMING_AWAY`, `ARMING_NIGHT`, `ARMING_VACATION`, `ARMING_CUSTOM`, `ARMED_HOME`, `ARMED_AWAY`, `ARMED_NIGHT`, `ARMED_VACATION`, `ARMED_CUSTOM`, `PENDING`, `DISARMING`, `TRIGGERED`, `FAULT`, `UNAVAILABLE`.

| Haus Internal State | HomeKit Current State     | HomeKit Target State     |
| ------------------- | ------------------------- | ------------------------ |
| DISARMED            | DISARMED (3)              | DISARM (3)               |
| ARMED_HOME          | STAY_ARM (0)              | STAY_ARM (0)             |
| ARMED_AWAY          | AWAY_ARM (1)              | AWAY_ARM (1)             |
| ARMED_NIGHT         | NIGHT_ARM (2)             | NIGHT_ARM (2)            |
| TRIGGERED           | ALARM_TRIGGERED (4)       | _(invariant: no target)_ |
| ARMING_*            | Prior stable state        | Requested target         |
| DISARMING           | Prior stable state        | DISARM (3)               |
| PENDING             | Prior armed state         | _(no change)_            |
| ARMED_VACATION      | AWAY_ARM (configurable)   | AWAY_ARM (configurable)  |
| ARMED_CUSTOM        | STAY_ARM (configurable)   | STAY_ARM (configurable)  |
| FAULT / UNAVAILABLE | Prior state + StatusFault | _(no change)_            |

## 9. HomeKit Lossless Semantic Proxy Data Structures

- **Lossless Semantic Proxy**: Haus terminates separate HAP cryptographic sessions on each boundary; it is an application-semantic proxy rather than a raw TCP transparent proxy.
- **Data Structures**: `RawHapAccessory`, `RawHapService`, `RawHapCharacteristic` preserving complete `/accessories` graph, unconsumed TLV8 payloads, permissions, and ranges.
- **Identity Mapping**: `HapProxyIdentityMapper` maintains persistent bidirectional translation between upstream `(aid, iid)` and outbound HAP server `(aid, iid)`.
- **Publication Policies**: `STANDARD_BRIDGE`, `ISOLATED_ACCESSORY`, `CAMERA_ACCESSORY`, `TV_ACCESSORY`, `HOMEKEY_ACCESSORY`, `ROUTER_ACCESSORY`, `MATTER_AGGREGATOR_ENDPOINT`.
- **Exporter Policies**: `native-only`, `custom-hap` (RFC 4122 v5 with `HAUS_HAP_NAMESPACE`), and `compatibility-projection`.
