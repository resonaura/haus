# Haus applications

The desktop, Home Assistant Helper add-on, and NVR node are developed in this
repository so their APIs, recording protocol, and shared contracts have one
source of truth. Keeping them together avoids duplicate fixes and version drift
between the app and the services it manages.

The deployment artifacts remain scoped to each application:

- [`helper/haus-helper`](helper/haus-helper) is the HA add-on and its Docker
  build context. The root [`repository.yaml`](../repository.yaml) registers this
  repository with Home Assistant; the add-on manifest is discovered below it.
- [`nvr`](nvr) is the independent NVR worker image and Docker Compose context.
  Its GHCR image remains separately versioned so nodes can update on their own
  schedule.

Use the root pnpm workspace for development and `pnpm check` for the complete
suite. The individual Docker contexts are still built and published by their
own root-level GitHub Actions workflows.
