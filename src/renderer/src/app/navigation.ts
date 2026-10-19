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
        | 'rooms'
        | 'integrations'
        | 'addons';
    }
  | { kind: 'devices'; areaId?: string }
  | { kind: 'room' | 'category'; id: string };
