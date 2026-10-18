/** Presentation only: keep registry names and entity IDs intact. */
export function deviceDisplayName(name: string, room?: string, fallback = 'Device'): string {
  const hue = /\(\s*hue\s*\)/i.test(name);
  let display = name
    .replace(/\(\s*hue\s*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!room?.trim()) return display || (hue ? 'Room' : fallback);
  const escaped = room
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  const prefix = new RegExp(`^${escaped}(?=$|[\\s:·|/–—-])(?:[\\s:·|/–—-]+)?`, 'iu');
  while (prefix.test(display)) display = display.replace(prefix, '').trim();
  const suffix = new RegExp(`(?:[\\s:·|/–—-]+)${escaped}$`, 'iu');
  display = display.replace(suffix, '').trim();
  return display || (hue ? 'Room' : fallback);
}

export const deviceSource = (name: string) => (/\(\s*hue\s*\)/i.test(name) ? 'Hue' : undefined);
