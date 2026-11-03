# Haus monorepo

Haus desktop, Haus Helper, and Haus NVR now share one canonical source
repository: <https://github.com/resonaura/haus>.

This keeps changes to the desktop, HA add-on, NVR worker, and their shared APIs
reviewable together. It avoids maintaining duplicate implementations and
reduces version drift in camera streaming, recordings, telemetry, and recovery
contracts. The applications remain separately deployable: Helper and NVR retain
their own versions, container images, release workflows, and Docker build
contexts inside `apps/`.

The migration is complete. Home Assistant runs Helper 0.3.57 from this
repository, and the existing NVR nodes run the 0.3.46 image published here.
Their previous instances and persistent data remain available for rollback.

The native HA integration also lives here, at `custom_components/haus`, for HACS
compatibility. Camera bridge image handoff uses the shared
[snapshot contract](bridge-snapshots.md); no separate Snappie service is needed.

The former Helper and NVR repositories remain public, read-only archives with
their histories intact and a notice pointing here. New source changes belong
in this Haus repository. The HA repository manifest is at the root, and all
three applications are included in the root checks.
