export type IntegrationEntry = {
  entry_id: string;
  domain: string;
  title: string;
  state: string;
  disabled_by: string | null;
  reason?: string | null;
  supports_options?: boolean;
  supports_reconfigure?: boolean;
  supports_unload?: boolean;
  pref_disable_new_entities?: boolean;
  pref_disable_polling?: boolean;
};
export type AddonInfo = {
  ingress?: boolean;
  webui?: string | null;
  slug: string;
  name: string;
  description: string;
  state?: string;
  version?: string;
  version_latest?: string;
  update_available?: boolean;
  installed?: boolean;
  available?: boolean;
  icon?: boolean;
  repository?: string;
  url?: string;
  long_description?: string;
  options?: Record<string, unknown>;
  schema?: FormField[];
  network?: Record<string, number | null>;
  boot?: string;
  boot_config?: string;
  auto_update?: boolean;
  watchdog?: boolean;
  ingress_panel?: boolean;
  documentation?: boolean;
  changelog?: boolean;
  system_managed?: boolean;
};
export type FormField = {
  multiple?: boolean;
  name: string;
  type?: string;
  required?: boolean;
  default?: unknown;
  description?: { suggested_value?: unknown };
  selector?: Record<string, any>;
  options?: Array<any> | Record<string, string>;
  schema?: FormField[];
  value_min?: number;
  value_max?: number;
};
export type FlowStep = {
  type: string;
  flow_id: string;
  handler: string;
  step_id?: string;
  data_schema?: FormField[];
  errors?: Record<string, string>;
  reason?: string;
  title?: string;
  url?: string;
  menu_options?: string[] | Record<string, string>;
  description_placeholders?: Record<string, string>;
  progress_action?: string;
  last_step?: boolean;
};
export const humanize = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export function translationStrings(
  resources: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(resources).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === 'string'
        ? [[path, value]]
        : value && typeof value === 'object' && !Array.isArray(value)
          ? Object.entries(translationStrings(value as Record<string, unknown>, path))
          : [];
    }),
  );
}
export function nativeApi() {
  if (!window.hausNative?.management) throw new Error('Restart Haus to load native management.');
  return window.hausNative;
}
export function rest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  data?: Record<string, unknown>,
) {
  return nativeApi().management<T>({ method, path, ...(data !== undefined ? { data } : {}) });
}
export async function supervisor<T>(
  endpoint: string,
  method = 'get',
  data?: Record<string, unknown>,
): Promise<T> {
  const result = await nativeApi().request<T & { result?: string; message?: string }>({
    type: 'supervisor/api',
    endpoint,
    method,
    ...(data !== undefined ? { data } : {}),
  });
  if (result?.result === 'error')
    throw new Error(result.message || 'Supervisor could not complete the operation.');
  return result;
}
export function schemaDefaults(schema: FormField[]): Record<string, unknown> {
  return Object.fromEntries(
    schema.flatMap((field) => {
      const value = field.default ?? field.description?.suggested_value;
      if (value !== undefined) return [[field.name, value]];
      if (field.schema) return [[field.name, schemaDefaults(field.schema)]];
      if (field.required && (field.type === 'boolean' || field.selector?.boolean !== undefined))
        return [[field.name, false]];
      return [];
    }),
  );
}
