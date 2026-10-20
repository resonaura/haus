import { expect, it } from 'vitest';
import { communityRepositoryName, filterCommunity, type CommunityRepository } from './hacs';
it('normalizes only actual GitHub repository names', () => {
  expect(communityRepositoryName('https://github.com/owner/project.git')).toBe('owner/project');
  expect(() => communityRepositoryName('https://github.com.evil/owner/project')).toThrow();
  expect(() => communityRepositoryName('../../file')).toThrow();
});
it('keeps hidden repositories separate, filters update scope and orders a large catalog without mutating source', () => {
  const repos = [
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
  ] as CommunityRepository[];
  expect(filterCommunity(repos, '', 'updates', 'all').map((repo) => repo.id)).toEqual(['1']);
  expect(filterCommunity(repos, '', 'hidden', 'all').map((repo) => repo.id)).toEqual(['2']);
  expect(filterCommunity(repos, '', 'browse', 'integration').map((repo) => repo.id)).toEqual([
    '3',
    '1',
  ]);
  expect(repos[0].id).toBe('1');
});
