const operations = {
  'hacs/info': [],
  'hacs/repositories/list': [],
  'hacs/repositories/removed': [],
  'hacs/critical/list': [],
  'hacs/repository/info': ['repository_id'],
  'hacs/repository/releases': ['repository_id'],
  'hacs/repository/release_notes': ['repository'],
  'hacs/repository/refresh': ['repository'],
  'hacs/repository/download': ['repository', 'version?'],
  'hacs/repository/remove': ['repository'],
  'hacs/repository/ignore': ['repository'],
  'hacs/repository/beta': ['repository', 'show_beta'],
  'hacs/repository/version': ['repository', 'version'],
  'hacs/repositories/remove': ['repository'],
  'hacs/repositories/add': ['repository', 'category'],
  'hacs/critical/acknowledge': ['repository'],
  'hacs/repositories/clear_new': ['repository?'],
} as const;
export const HACS_COMMANDS = Object.keys(operations);
export function validateHacsRequest(input: Record<string, unknown>): void {
  const type = String(input.type);
  const fields = operations[type as keyof typeof operations] as readonly string[] | undefined;
  if (
    !fields ||
    Object.keys(input).some(
      (key) => key !== 'type' && !fields.some((field) => field.replace('?', '') === key),
    ) ||
    fields.some((field) => !field.endsWith('?') && input[field] === undefined)
  )
    throw Error('Invalid community operation.');
  for (const [field, value] of Object.entries(input)) {
    if (field === 'type') continue;
    if (field === 'show_beta') {
      if (typeof value !== 'boolean') throw Error('Choose a valid release channel.');
      continue;
    }
    if (
      typeof value !== 'string' ||
      value.length > 160 ||
      !value.trim() ||
      [...value].some((character) => character.charCodeAt(0) < 32)
    )
      throw Error('Invalid community repository setting.');
    if (field === 'repository' || field === 'repository_id') {
      const fullName = type === 'hacs/repositories/add' || type === 'hacs/critical/acknowledge';
      if (!(fullName ? /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/ : /^\d{1,24}$/).test(value))
        throw Error('Choose a valid community repository.');
    }
    if (
      field === 'category' &&
      ![
        'integration',
        'plugin',
        'theme',
        'template',
        'python_script',
        'appdaemon',
        'netdaemon',
      ].includes(value)
    )
      throw Error('Choose a valid community category.');
  }
}
