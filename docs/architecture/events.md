# Provider events and reconnects

Owned sources use `haus.event` version 2 with home/source identity, authenticated connection epoch, owner Hub/process, owner generation and a monotonically increasing sequence. The composition root supplies the trusted `ProviderSession` to `Home.connect`; an incoming event never elects or authenticates an owner.

`Home` pins that binding and rejects wrong-home, wrong-source, old or unsolicited-new owner generations, wrong process/epoch, duplicate and out-of-order sequences. Reconnect retains the pinned binding unless an explicit authenticated replacement is provided. A replacement cannot lower the generation or change owners within the same generation. Local subscription generations also fence callbacks and bootstrap replies from an earlier connection.

Legacy version 1 remains available for current standalone sources. An owned source never downgrades to it. A legacy source cannot promote itself merely by sending a v2 event. The HA adapter emits v2 when configured with an owner binding; production wiring and authenticated host routing remain P2/P5 work.

A streamed snapshot that supersedes a pending bootstrap request remains authoritative if that old request later fails, including a synchronous event during subscription. A source outage marks only its own records offline/cached. Another source's cameras or devices remain available. Endpoints must reference devices within their own validated snapshot, and a source cannot claim another source's canonical IDs.

Evidence: `packages/core/test/events.test.ts` exercises owner/session/home mismatch, downgrade, duplicates, out-of-order delivery, replaced callbacks, owner rollback, bootstrap races and foreign-device references. Existing source-isolation tests and the HA adapter envelope test cover the compatibility path. These fixtures establish event-fencing behavior, not a production network-partition or node-failover claim.
