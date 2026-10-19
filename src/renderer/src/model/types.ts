/** Home Assistant wire types. These modules deliberately have no browser or Node dependencies. */
export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated?: string;
}

export interface Area {
  area_id: string;
  name: string;
  floor_id?: string | null;
  icon?: string | null;
  [key: string]: unknown;
}

export interface Device {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  area_id?: string | null;
  parent_device_id?: string | null;
  via_device_id?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  [key: string]: unknown;
}

export interface EntityRegistryEntry {
  entity_id: string;
  device_id?: string | null;
  area_id?: string | null;
  name?: string | null;
  original_name?: string | null;
  entity_category?: 'config' | 'diagnostic' | string | null;
  disabled_by?: string | null;
  hidden_by?: string | null;
  platform?: string | null;
  unique_id?: string | null;
  [key: string]: unknown;
}

export interface Snapshot {
  states: HassEntity[];
  areas: Area[];
  devices: Device[];
  entities: EntityRegistryEntry[];
  sceneConfigs?: Record<string, Record<string, unknown>>;
  sceneArtwork?: Record<string, { colors: string[]; dark?: boolean }>;
  pendingEntityIds?: string[];
  pendingSince?: Record<string, number>;
  services: Record<string, Record<string, any>>;
  config: {
    location_name: string;
    version?: string;
    unit_system?: { temperature: string };
    [key: string]: unknown;
  };
  user: { name: string; is_admin: boolean; [key: string]: unknown };
}

export type Category =
  | 'lights'
  | 'climate'
  | 'security'
  | 'media'
  | 'water'
  | 'outlets'
  | 'covers'
  | 'printers'
  | 'network'
  | 'other';

export interface HausAccessory {
  id: string;
  deviceId?: string;
  primaryEntityId: string;
  entityIds: string[];
  areaId?: string;
  manufacturer?: string | null;
  model?: string | null;
  category: Category;
  name: string;
  batteryLevel?: number;
  powerStrip?: boolean;
  buttonController?: boolean;
  physicalHub?: boolean;
  visibilityEntityIds?: string[];
  availability: 'available' | 'unavailable' | 'unknown';
  capabilities: string[];
  state: HassEntity;
  secondaryEntities: HassEntity[];
  defaultHidden?: boolean;
  isService?: boolean;
  pending?: boolean;
  pendingSince?: number;
  /** Local presentation group. Its members remain independent Home Assistant devices. */
  lightGroup?: { key: string; members: HausAccessory[] };
}

export interface HausRoom {
  id: string;
  name: string;
  accessories: HausAccessory[];
}

export interface HausModel {
  accessories: HausAccessory[];
  rooms: HausRoom[];
  scenes: HassEntity[];
  scenePlacements: Array<{
    sceneId: string;
    areaId?: string;
    scope: 'room' | 'home';
    confidence: number;
    targetCount: number;
    matchScore?: number;
    matchCoverage?: number;
    active?: boolean;
  }>;
  cameras: HassEntity[];
  attention: Array<{
    id: string;
    title: string;
    description: string;
    entityId: string;
    severity: 'warning' | 'critical';
  }>;
}

export interface HausAction {
  domain: string;
  service: string;
  target: { entity_id: string };
  service_data?: Record<string, unknown>;
}
