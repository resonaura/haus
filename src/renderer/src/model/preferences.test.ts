import { expect, it } from 'vitest';
import { defaults, sanitizePreferences } from './preferences';
it('follows system appearance by default and keeps deliberate light/dark choices', () => {
  expect(defaults.theme).toBe('system');
  expect(sanitizePreferences({}).theme).toBe('system');
  expect(sanitizePreferences({ theme: 'invalid' }).theme).toBe('system');
  expect(sanitizePreferences({ theme: 'light' }).theme).toBe('light');
  expect(sanitizePreferences({ theme: 'dark' }).theme).toBe('dark');
});
