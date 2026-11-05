# Hub-owned provider control

`Integration<Credential>` composes the Host repositories, encrypted vault, `OwnedCredentials`, `TokenRefresh` and `Commands`. Neutral provider/credential/inventory ports live in `@haus/core/provider`, so adapters do not import Hub application types. Definitions supply a validated credential codec and synchronous, I/O-free construction. The provider's Open/Execute/Refresh/Close methods are the adapter boundary. They must not rotate credentials outside the owned refresh path or leave detached session work behind Close.

The mandatory permissions port receives a trusted actor, the pinned integration resource and an explicit management/control action. Unknown/unavailable permission checks deny access; timeout and shutdown cancel a pending lookup so it cannot hold provider startup or teardown. The API composition must derive the actor from authentication; it must never trust a body-supplied actor, grant, fencing proof or generation. The integration checks its home against the Host before constructing a vault or provider.

Sign-in, recovery and disconnect serialize per integration. Sign-in persists credentials before opening the provider; failure retains ownership and requires reauthorization. A new explicit sign-in stops/drains the previous provider and refresher before installing replacement credentials. Commands wait for an active refresh, then recheck the captured session/dispatcher. Reauthorization cannot accidentally move a delayed command into the replacement connection.

## Admission and fencing

`ProviderGate` closes local admission synchronously and combines caller cancellation with its lifetime signal. It checks that signal immediately before invoking a provider, including after asynchronous credential reads. This prevents a delayed command from entering an old connection even when reauthorization retains the same owner generation.

The gate tracks the underlying provider promises, independently of the caller's timeout/abort result. Provider contexts expose owned credential reads/refresh, pinned to that particular gate; replaced/closed contexts cannot use a new connection's credentials. Fencing requires both successful provider Close and completed underlying work. A bounded fence timeout or failed Close leaves durable ownership reserved in Revoking. An explicit verified cleanup retry can finish it later; timeout alone never grants another writer. Physical actions with lost acknowledgements retain Unknown receipts and are not replayed.

Host command fingerprints use a domain-separated HKDF-derived HMAC key and canonical JSON. Object key order and transport request IDs do not change the action fingerprint; home, endpoint, capability, operation and arguments do. Raw arguments do not enter the receipt journal. The local master key keeps fingerprints stable across process restart.

## Local restart and logout

Recovery checks the persisted owner before acquiring a new generation. Another Hub or another live controller in the same process cannot be treated as a local restart. An already Revoked record carries completed fencing; any other old process needs the injected trusted local/provider fencing proof.

`OsProcessRecovery` implements `LocalRecovery` using OS process verification via `process.kill(pid, 0)`. When a previous lease incarnation is on the same Hub with a distinct process ID, it confirms the predecessor PID is dead (or signals it and waits for exit) before permitting generation rebinding. If verification cannot be proven, recovery fails closed with `integration_recovery_unverified`. `Host.open()` chains active and previous process leases to ensure sequential restarts retain verified fencing evidence.

After fencing, the vault may rebind only a Ready credential to the next local generation with a different process incarnation. Pending/Blocked credentials never resume; they require a new sign-in. An interrupted fencing path also requires reauthorization. Explicit user disconnect erases the resource's stored credential, including an older blocked generation. Ordinary service shutdown retains a Ready encrypted credential for a later verified restart.

## Authenticated control routing and bootstrap lifecycle

`ControlService` coordinates registered integrations behind explicit permissions (`TrustedControlPermissions`), managing life cycles (`connect`, `resume`, `disconnect`, `refresh`, `execute`, `session`). HTTP control routes are exposed under `/api/control/integrations/:id/(connect|resume|disconnect|refresh|command|session)`. The caller actor identity is derived strictly from authentication (`local-admin` or validated Ingress session user) and never accepted from request parameters or payloads. Unknown/invalid routes or verbs return HTTP 404/405; unauthorized attempts return HTTP 403; idempotency conflicts return HTTP 409; and missing/invalid JSON payloads return HTTP 400.

`Host.close` runs strictly after all integration instances close and fence their underlying providers (`ControlService.close()`). The Hub bootstrap registers `haIntegrationDefinition` and registers an orderly teardown callback via `scope.defer()`. Existing compatibility clients and installed metadata remain intact.

Evidence: `apps/hub/test/control` uses real Host/SQLite storage, HTTP loopback servers, and isolated provider/proof fixtures. It covers route authentication, permission mapping, command dispatch with idempotency, unknown outcome preservation across restart, blocked interrupted token recovery across restart, ordered shutdown, and `OsProcessRecovery` dead PID verification.
