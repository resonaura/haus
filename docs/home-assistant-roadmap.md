# Smart home capability roadmap

Haus now operates as a standalone smart home platform (`apps/hub`) with native protocols, Kitsune virtualization, local scene/automation management, device statistics/history, local room management, repairs/updates attention center, and physical camera/power-strip relationships.

The remaining rows below are product proposals for future Haus Hub and client capabilities (compatible with native entities and optional Home Assistant adapters). Show each capability only when the connected home supports it; avoid empty dashboards and unexplained entity lists.

| Priority | User-facing experience                                                             | Foundation / domain entities                 | Implementation boundary                                                                                           |
| -------- | ---------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1        | Shared shopping and household lists, with quick-add and completion checkboxes      | `todo` entities and item CRUD actions        | Add a `features/tasks` view with optimistic item updates; synchronize by item UID, never by display text          |
| 2        | “Energy today”: consumption, cost when a tariff exists, and top contributing loads | Energy configuration and recorder statistics | Extend `statistics` with capability checks and distinct power/energy/cost units; show missing data honestly       |
| 2        | Upcoming household events and schedules                                            | Calendar entities and event retrieval        | Compact agenda rather than raw entity cards; handle home time zone and all-day events explicitly                  |
| 3        | Conversational home control (text first, optional voice)                           | Local / Assist conversation pipeline         | Start with text to avoid unnecessary microphone prompts; explain chosen targets and preserve safety confirmations |
| 3        | Room organization across floors and custom collections                             | Area, floor, and label registries            | Keep the single-home overview uncluttered and preview bulk moves before committing                                |

## Rollout criteria

Every new feature requires a typed Hub/adapter contract, explicit loading/empty/error states, predictable optimistic updates where safe, and read-only behavior for non-admin sessions. Exercise interactions against isolated demo/test fixtures first; never auto-rename or regroup devices via fuzzy matching without user review.
