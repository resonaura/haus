# Haus monorepo

Haus desktop, Haus Helper, and Haus NVR now share one canonical source
repository: <https://github.com/resonaura/haus>.

This keeps changes to the desktop, HA add-on, NVR worker, and their shared APIs
reviewable together. It avoids maintaining duplicate implementations and
reduces version drift in camera streaming, recordings, telemetry, and recovery
contracts. The applications remain separately deployable: Helper and NVR retain
their own versions, container images, release workflows, and Docker build
contexts inside `apps/`.

After Home Assistant and the existing nodes switch to this source, the former
standalone repositories will be retained as public, read-only archives with
their histories intact. New source changes belong in this Haus repository. The
HA repository manifest is at the root, and all three applications are included
in the root checks.
