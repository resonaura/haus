# Integration session ownership

`@haus/core/session` defines one owner per home-scoped integration resource. Ownership identifies the Hub, a unique running-process incarnation and a monotonically increasing generation. Coordinator election, lost heartbeats and token expiry do not grant ownership. A restarted process cannot reuse the previous incarnation's live session.

The host's asynchronous `SessionRepository` serializes durable transitions between processes. These contracts are internal trusted ports, not public authorization APIs: authenticated Hub routing and scoped actor permissions remain mandatory. A `SessionGrant` is a fencing reference and must not be accepted as a bearer credential.

The state path is `connecting → connected`. Expired/invalid credentials enter `reauth-required`, keeping the owner reserved. Explicit successful sign-in permits `connecting` again. Revocation durably enters `revoking` before cleanup begins. Its injected fencing operation must close/drain the old provider session and reject further submissions through it, including calls delayed across asynchronous checks. Only successful fencing permits `revoked` and a new owner/generation. Failed or unreachable fencing leaves the resource unavailable; timeout alone never promotes a second writer. Repeated fencing must be idempotent.

`OwnedCredentials` reads only the owning process's secure vault. It checks ownership before and after secure-store access and after the operation. Metadata replication contains no tokens. Adapters must return sanitized results/errors and keep secrets out of their logs; a generic callback is an internal adapter facility, not a renderer API. A running operation must be drained/cancelled by the fencing implementation, since a lost result does not undo an already-dispatched physical action.

Other Hubs route authorized commands to the owner and receive readings/receipts. They do not receive its refresh token. Credential transfer/reauthorization after verified fencing is a separate explicit flow; ordinary configuration replication must not implement it accidentally. P2 supplies the host repositories and composition; P5 supplies authenticated routing and distributed fencing before these contracts can replace production ownership.

## Rotating-token refresh

`TokenRefresh` shares one in-flight exchange per owner/generation. Before calling a provider, `RefreshVault.begin` durably reserves an attempt. A second service/process sees Busy rather than dispatching another refresh. The secure vault must reject credential reads while pending/blocked and retain the pending marker after process failure. A new sign-in is the explicit way to replace an uncertain credential; recreating the refresher does not reset its state.

A bounded provider timeout or lost response blocks reuse and requires reauthorization. It never automatically retries a possibly consumed rotating token. Late responses cannot commit after timeout/fencing; every commit checks the owner generation and exact attempt. A failed replacement write or failed recovery leaves a blocked/pending marker. Diagnostic errors contain stable reason codes only, without provider messages or tokens. Fencing aborts/drains the refresher and propagates unresolved secure-store recovery failures, keeping takeover blocked.

The current HA desktop/mobile auth paths remain compatibility clients until P2.3 moves sign-in and refresh to Hub-owned APIs. This neutral refresh service specifies and exercises the new owner contract; it does not claim those production clients already share a Hub session.

Evidence: `packages/core/test/session.test.ts` covers competing authorities, process restart, delayed/failed fencing, stale generations, local-only credential reads, revocation during vault access and explicit reauthorization. The in-memory repository is an atomic contract fixture, not proof of cross-host consensus or production failover.

`OrmSessions` in `apps/hub/src/storage/session.ts` is the real TypeORM repository. It retains generation/state across database reopen and serializes claims across DataSources/processes. Its internal `guard` holds a catalog writer lock while a bounded local vault operation runs, so revocation cannot race that operation. Lock order is catalog → separate vault; callbacks must not reenter catalog repositories. This guard is not distributed consensus or a network-operation lock.

`packages/core/test/refresh.test.ts` covers concurrent consumers, durable Busy after recreation, timeout/late completion, provider rejection, secure-store failures, restart with blocked credentials and refresh cancellation during ownership revocation.
