/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it, vi } from 'vitest';
import {
  buildDemoBridgeSuggestions,
  buildDemoHacsState,
  buildHacsVersionOptions,
  communityRepositoryName,
  fetchBridgeSuggestions,
  filterCommunity,
  formatHacsRepositoryError,
  parseBridgeSuggestionsResponse,
  type CommunityRepository,
  type ManagementPort,
  type ManagementRequest,
} from '../../src/transport/index.js';

it('normalizes GitHub HACS repository names and rejects untrusted hosts', () => {
  expect(communityRepositoryName('https://github.com/owner/project.git')).toBe('owner/project');
  expect(communityRepositoryName('https://github.com/owner/project/tree/main')).toBe(
    'owner/project',
  );
  expect(communityRepositoryName('owner/project')).toBe('owner/project');
  expect(() => communityRepositoryName('https://github.com.evil/owner/project')).toThrow();
  expect(() => communityRepositoryName('../../file')).toThrow();
});

it('formats known HACS backend validation and rate-limit errors', () => {
  expect(formatHacsRepositoryError(new Error('hacs_is_addon_repository:o/r'))).toContain(
    'Add-on repository',
  );
  expect(formatHacsRepositoryError(new Error('hacs_repository_exists:o/r'))).toContain(
    'already exists',
  );
  expect(formatHacsRepositoryError(new Error('hacs_repository_archived:o/r'))).toContain(
    'archived',
  );
  expect(formatHacsRepositoryError(new Error('hacs_manifest_missing:o/r'))).toContain(
    'manifest.json',
  );
  expect(formatHacsRepositoryError(new Error('hacs_repository_not_found:o/r'))).toContain(
    'not found on GitHub',
  );
  expect(
    formatHacsRepositoryError(new Error('hacs_repository_installed_remove_first:o/r')),
  ).toContain('Remove the downloaded integration');
  expect(formatHacsRepositoryError(new Error('github_rate_limited'))).toContain('rate limit');
});

it('filters and sorts HACS repositories without mutating source lists', () => {
  const repos: readonly CommunityRepository[] = [
    {
      id: '1',
      name: 'Second',
      full_name: 'o/second',
      category: 'integration',
      installed: true,
      pending_upgrade: true,
      stars: 10,
    },
    {
      id: '2',
      name: 'First',
      full_name: 'o/first',
      category: 'theme',
      installed: false,
      hide: true,
      stars: 20,
    },
    {
      id: '3',
      name: 'Popular',
      full_name: 'o/popular',
      category: 'integration',
      installed: false,
      stars: 30,
    },
  ];
  expect(filterCommunity(repos, '', 'updates', 'all').map((repo) => repo.id)).toEqual(['1']);
  expect(filterCommunity(repos, '', 'hidden', 'all').map((repo) => repo.id)).toEqual(['2']);
  expect(filterCommunity(repos, '', 'browse', 'integration').map((repo) => repo.id)).toEqual([
    '3',
    '1',
  ]);
  expect(repos[0]?.id).toBe('1');
});

it('builds distinct version options respecting prerelease toggle and demo catalog state', () => {
  const demo = buildDemoHacsState();
  const repo = demo.repositories[0]!;
  const releases = demo.releasesById[String(repo.id)] ?? [];
  expect(buildHacsVersionOptions(repo, releases)).toEqual(['v1.24.1', 'v1.22.0', 'main']);
  expect(buildHacsVersionOptions({ ...repo, beta: true }, releases)).toEqual([
    'v1.24.1',
    'v1.22.0',
    'v1.25.0-beta.1',
    'main',
  ]);
  expect(demo.critical.some((item) => !item.acknowledged)).toBe(true);
  expect(demo.removed.length).toBeGreaterThan(0);
});

it('parses and fetches Apple Home bridge suggestions and provides demo groups', async () => {
  expect(parseBridgeSuggestionsResponse({ suggestions: [] })).toEqual([]);
  expect(() => parseBridgeSuggestionsResponse(null)).toThrow('invalid_bridge_suggestions');
  expect(() =>
    parseBridgeSuggestionsResponse({ suggestions: [{ name: 'Room', devices: [{ id: 1 }] }] }),
  ).toThrow('invalid_bridge_suggestions');

  const spy = vi.fn((_input: ManagementRequest) => ({
    suggestions: [
      {
        name: 'Living Room Lights',
        devices: [
          { id: 'dev-1', name: 'Floor Lamp' },
          { id: 'dev-2', name: 'Ceiling Spots' },
        ],
      },
    ],
  }));
  const port: ManagementPort = {
    async management<T = unknown>(input: ManagementRequest): Promise<T> {
      return spy(input) as T;
    },
  };
  const loaded = await fetchBridgeSuggestions(port);
  expect(spy).toHaveBeenCalledWith({
    method: 'GET',
    path: 'homekit/bridge/suggestions',
  });
  expect(loaded).toHaveLength(1);
  expect(loaded[0]?.devices).toHaveLength(2);
  expect(buildDemoBridgeSuggestions().length).toBeGreaterThanOrEqual(2);
});
