import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkOrganizationNameAvailable } from './organization';
import { prisma } from '@/lib/prisma';

// Mock the prisma client
vi.mock('@/lib/prisma', () => {
  return {
    prisma: {
      organization: {
        findUnique: vi.fn(),
      },
    },
  };
});

describe('checkOrganizationNameAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when organization name does not exist', async () => {
    // Mock findUnique to return null (no organization found)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);

    const result = await checkOrganizationNameAvailable('New Org Name');

    expect(result).toBe(true);
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { name: 'New Org Name' },
    });
  });

  it('should return false when organization name already exists', async () => {
    // Mock findUnique to return an existing organization
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 'existing-id',
      name: 'Existing Org Name',
      dba: null,
      ein: null,
      staffCount: null,
      primaryContact: null,
      primaryEmail: 'test@example.com',
      phone: null,
      address: null,
      country: null,
      state: null,
      zipCode: null,
      city: null,
      licenseNumber: null,
      isHipaaCompliant: false,
      primaryBusinessType: null,
      additionalBusinessTypes: [],
      programServices: [],
      slug: 'existing-org-name',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await checkOrganizationNameAvailable('Existing Org Name');

    expect(result).toBe(false);
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { name: 'Existing Org Name' },
    });
  });
});
