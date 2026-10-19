export type Route =
  | {
      kind:
        | 'home'
        | 'automations'
        | 'scenes'
        | 'cameras'
        | 'attention'
        | 'settings'
        | 'statistics'
        | 'favorites'
        | 'hidden'
        | 'devices'
        | 'integrations'
        | 'addons';
    }
  | { kind: 'room' | 'category'; id: string };
