# Home Assistant Config Flow Support Matrix & Capability Adaptation

Haus adapts Home Assistant integration config flows by evaluated capability. Rather than promising universal compatibility with all arbitrary Home Assistant frontend controls, custom integrations, and Lovelace selectors, Haus inventories supported capabilities and provides an honest fallback to the Home Assistant Web UI when encountering unsupported steps or custom selectors.

## Per-Flow Support Matrix

| Integration Domain                                                                                                                                                                                          | Primary Auth Method                      | Status             | Notes                                                                                                                    |
| :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------- | :----------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `mqtt`, `generic`, `shelly`, `homekit_controller`, `wled`, `hue`, `nanoleaf`, `tuya`, `zha`, `matter`, `esphome`, `tasmota`, `plex`, `synology_dsm`, `unifi`, `tplink`, `sonos`, `roku`, `cast`, `apple_tv` | Form-based setup                         | `supported`        | Standard text, numbers, booleans, dropdowns, entity, device, and area selectors are rendered natively.                   |
| `spotify`, `nest`, `google`, `google_assistant`, `smartthings`, `netatmo`, `withings`, `tesla`, `fitbit`, `strava`, `github`, `ecobee`, `dropbox`                                                           | OAuth / External Browser                 | `supported-oauth`  | Step type `external` directs user to browser authorization via `openIntegrationLogin` and continues setup upon callback. |
| Any integration with `context.source === 'reauth'` or `'reconfigure'`                                                                                                                                       | Reauth / Reconfiguration                 | `supported-reauth` | In-flight re-authentication steps are prioritized and handled natively.                                                  |
| `bluetooth`, `usb`                                                                                                                                                                                          | Hardware / Host dependency               | `unsupported`      | Requires host BlueZ daemon or physical USB bus attachment. Directs user to HA Web UI.                                    |
| `zwave_js`, `hassio`                                                                                                                                                                                        | External service / Supervisor dependency | `unsupported`      | Requires external daemon server or Supervisor add-on. Directs user to HA Web UI.                                         |

## Supported vs Unsupported Selectors

### Supported Selectors

- **Primitive & Text**: `string`, `text`, `password`, `boolean`, `bool`, `number`, `integer`, `float`, `positive_int`
- **Options**: `select`, `multi_select`
- **Relational**: `entity`, `device`, `area`
- **Structures**: `object`, `dict`, `list`, `target`, `action`, `condition`, `trigger`, `template`
- **Date & URL**: `date`, `time`, `datetime-local`, `url`, `email`

### Unsupported Custom Selectors

The following selectors require Lovelace card engines, voice pipelines, or Supervisor frontend modules:

- `addon`: Supervisor add-on inventory and installation selector
- `theme`: Lovelace theme selector
- `icon`: Material Design Icons browser
- `qr_code`: QR code scanner/renderer
- `conversation_agent`: Voice assistant pipeline selector
- `navigation`: Dashboard view route selector
- `ui_action`: Card tap/hold action editor
- `location`: Leaflet / OpenStreetMap map coordinate picker
- `color_rgb`, `color_temp`: Interactive color wheel controls

## Honest Fallback Mechanism

When `evaluateFlowStep` detects an unsupported step type or any unsupported selector in `data_schema`:

1. The step is assessed as `unsupported`.
2. The UI switches to `UnsupportedFlowFallback`, displaying the specific unhandled requirements (e.g. `icon`, `addon`, `location`).
3. An explicit action **"Open in Home Assistant Web"** links directly to `http://<ha-url>/config/config_entries/flow/<flow_id>` so the user can complete the specialized setup in Home Assistant without errors or corrupt state.
