# Friendly Home Assistant features to add next

These are product proposals based on the current Haus implementation and official HA capabilities. They are not implemented features. Show each capability only when the connected home supports it; avoid empty dashboards and unexplained entity lists.

| Priority | User-facing experience                                                                                                | HA foundation                                                          | Implementation boundary                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Create a scene from the current room, preview the affected devices and save it; simple “When / If / Then” automations | Scene configuration and automation APIs already used or linked by Haus | New editors under `features/scenes` and `features/automations`; explicit targets and a review before save; preserve unknown server fields |
| 1        | “Your home needs attention”: group a repair, its affected integration and a clear next step                           | Repairs, persistent notifications and update entities                  | Build on the existing notification adapter, not a second alert system; distinguish view, dismiss, ignore and install actions              |
| 1        | Device health: battery, last contact, unavailable devices and printer supplies with last-known values                 | Existing state, recorder/history and diagnostic entities               | Extend the device view model; surface timestamps and data gaps rather than inventing a current value                                      |
| 2        | Shared shopping and household lists, with an add field and completion checkboxes                                      | `todo` entities and get/add/update item actions                        | Add a `features/tasks` adapter and optimistic item changes; synchronize by item UID, never by display text                                |
| 2        | “Energy today”: consumption, cost when a tariff exists, and the devices contributing most                             | HA energy configuration and recorder statistics                        | Extend statistics with capability checks and units; power, energy and cost are different measurements; show missing data honestly         |
| 2        | Upcoming household events and schedules                                                                               | Calendar entities and event retrieval                                  | A compact agenda rather than a technical entity card; handle home time zone and all-day events explicitly                                 |
| 3        | Type a request to the home, then optionally use voice                                                                 | Assist conversation and voice pipeline                                 | Start with text to avoid unnecessary microphone prompts. Explain the devices/actions chosen; keep device-specific confirmation behavior   |
| 3        | Room organization across floors and custom collections                                                                | HA area/floor/label registries                                         | Add navigation only when useful. Keep the current one-home experience simple and offer a preview for bulk moves                           |

## Rollout criteria

A feature should have a real server adapter, clear loading/empty/error states, predictable optimistic behavior where applicable, and a read-only path for users without admin rights. Use the demo for interaction tests. Real hardware tests for this home stay in Narnia, with lights restored off, and must not overwrite existing scenes.

Avoid automatic server renaming or regrouping based on fuzzy matching. Suggest a relationship, show its evidence, let the user review it, and keep HA device/entity IDs stable unless a deliberate migration is requested.

## Sources

- [HA scene editor](https://www.home-assistant.io/docs/scene/editor/)
- [HA automation editor](https://www.home-assistant.io/docs/automation/editor/)
- [HA Repairs](https://www.home-assistant.io/integrations/repairs/)
- [HA to-do lists](https://www.home-assistant.io/integrations/todo/) — local and integration-backed lists, item state and actions.
- [HA energy management](https://www.home-assistant.io/docs/energy/) — consumption, production and costs when configured.
- [HA calendar](https://www.home-assistant.io/integrations/calendar/)
- [HA Assist](https://www.home-assistant.io/voice_control/)
- [HA device organization](https://www.home-assistant.io/docs/organizing/)
