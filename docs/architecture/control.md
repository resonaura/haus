# Hub-owned provider control

`Integration<Credential>` composes the Host repositories, encrypted vault, `OwnedCredentials`, `TokenRefresh` and `Commands`. Provider definitions supply a validated credential codec and synchronous, I/O-free construction. The provider's Open/Execute/Refresh/Close methods are the adapter boundary. They must not rotate credentials outside the owned refresh path or leave detached session work behind Close.

The mandatory permissions port receives a trusted actor, the pinned integration resource and an explicit management/control action. Unknown/unavailable permission checks deny access; timeout and shutdown cancel a pending lookup so it cannot hold provider startup or teardown. The API composition must derive the actor from authentication; it must never trust a body-supplied actor, grant, fencing proof or generation. The integration checks its home against the Host before constructing a vault or provider.

Sign-in, recovery and disconnect serialize per integration. Sign-in persists credentials before opening the provider; failure retains ownership and requires reauthorization. A new explicit sign-in stops/drains the previous provider and refresher before installing replacement credentials. Commands wait for an active refresh, then recheck the captured session/dispatcher. Reauthorization cannot accidentally move a delayed command into the replacement connection.

## Admission and fencing

`ProviderGate` closes local admission synchronously and combines caller cancellation with its lifetime signal. It checks that signal immediately before invoking a provider, including after asynchronous credential reads. This prevents a delayed command from entering an old connection even when reauthorization retains the same owner generation.

The gate tracks the underlying provider promises, independently of the caller's timeout/abort result. Fencing requires both successful provider Close and completed underlying work. A bounded fence timeout or failed Close leaves durable ownership reserved in Revoking. An explicit verified cleanup retry can finish it later; timeout alone never grants another writer. Physical actions with lost acknowledgements retain Unknown receipts and are not replayed.

Host command fingerprints use a domain-separated HKDF-derived HMAC key and canonical JSON. Object key order and transport request IDs do not change the action fingerprint; home, endpoint, capability, operation and arguments do. Raw arguments do not enter the receipt journal. The local master key keeps fingerprints stable across process restart.

## Local restart and logout

Recovery checks the persisted owner before acquiring a new generation. Another Hub or another live controller in the same process cannot be treated as a local restart. An already Revoked record carries completed fencing; any other old process needs the injected trusted local/provider fencing proof. The production OS proof adapter is part of P2.0b.3/P3.5, not inferred from a disconnected socket or tested by a mock.

After fencing, the vault may rebind only a Ready credential to the next local generation with a different process incarnation. Pending/Blocked credentials never resume; they require a new sign-in. An interrupted fencing path also requires reauthorization. Explicit user disconnect erases the resource's stored credential, including an older blocked generation. Ordinary service shutdown retains a Ready encrypted credential for a later verified restart.

`Host.close` must run after its integrations have closed. P2.0b.3 attaches this order and authenticated routing to the actual Hub bootstrap. Existing desktop/mobile authentication remains on its compatibility path until P2.3. No production control path is replaced merely by these classes or exports.

Evidence: `apps/hub/test/control` uses real Host/SQLite storage and isolated provider/proof fixtures. It covers permission denial, credential replacement, refresh coalescing, delayed secure-store admissions, shutdown during Open/Refresh, failed/unresolved fencing, source isolation, explicit logout, restart replay, exact generation recovery and blocked interrupted tokens. It establishes composition behavior, not physical provider or OS fencing acceptance.
