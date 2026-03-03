import { describe, it, expect, vi, beforeEach } from 'vitest';

// ESM module mocking must be hoisted — use vi.mock at the top level
vi.mock('../src/graph/client.js', () => ({
  getUserGroups: vi.fn(),
}));

import { getUserGroups } from '../src/graph/client.js';
import { GroupSyncService } from '../src/graph/group-sync.js';

describe('GroupSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when getUserGroups returns no groups', async () => {
    vi.mocked(getUserGroups).mockResolvedValue([]);

    // sql is never called when azureGroups is empty
    const mockSql = vi.fn() as unknown as Parameters<typeof GroupSyncService>[0];
    const service = new GroupSyncService(mockSql);

    const result = await service.syncUserGroups({
      userId: 'user-1',
      institutionId: 'inst-1',
      accessToken: 'token',
    });

    expect(result.groupsFound).toBe(0);
    expect(result.departmentsAssigned).toHaveLength(0);
    expect(result.rolesApplied).toEqual({});
  });

  it('returns empty result and logs when Graph API throws', async () => {
    vi.mocked(getUserGroups).mockRejectedValue(new Error('Network error'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockSql = vi.fn() as unknown as Parameters<typeof GroupSyncService>[0];
    const service = new GroupSyncService(mockSql);

    const result = await service.syncUserGroups({
      userId: 'user-1',
      institutionId: 'inst-1',
      accessToken: 'bad-token',
    });

    expect(result.groupsFound).toBe(0);
    expect(result.departmentsAssigned).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Graph API group fetch failed:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it('returns groupsFound count and empty departments when no mappings match', async () => {
    vi.mocked(getUserGroups).mockResolvedValue(['Group A', 'Group B']);

    // sql returns empty mappings array
    const mockSql = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof GroupSyncService>[0];
    const service = new GroupSyncService(mockSql);

    const result = await service.syncUserGroups({
      userId: 'user-1',
      institutionId: 'inst-1',
      accessToken: 'token',
    });

    expect(result.groupsFound).toBe(2);
    expect(result.departmentsAssigned).toHaveLength(0);
  });
});
