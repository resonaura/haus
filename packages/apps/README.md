# Apps

`Apps` is the provider-independent application manager. Drivers implement inventory and explicit advertised actions; the manager owns source-scoped persistent identity, permission checks, command ordering and last-known unavailable inventory. It does not issue automatic write retries.

`DockerApps` negotiates a compatible Docker Engine API version and maps existing containers. Only explicitly Haus-labelled containers are manageable; other discovered containers are read-only. `DockerSocket` is an explicit host-only local transport with a closed operation allowlist, response limit and timeout. Desktop/mobile never receive a Docker socket or arbitrary daemon proxy.

`SupervisorApps` lives in `@haus/ha/apps` and implements the same contract. Register it only when an actual Supervisor is available, independently of the home/device backend. HA Container, a future Homebridge backend or HausOS can use Docker Apps without adopting Supervisor.

The initial common lifecycle is start/stop/restart of existing managed installations. Package installation, configuration, logs, secrets, updates and rollback need their own advertised contracts before a generic UI can replace those existing provider-specific flows. Unsupported operations are not advertised. No Docker daemon or household app is changed by construction or tests.
