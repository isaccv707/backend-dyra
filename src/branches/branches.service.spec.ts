import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { BranchesService } from './branches.service';

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';

const provider = {
  id: 'p1',
  nameProvider: 'Telmex',
  accountNumber: '123456',
  monthlyPrice: new Prisma.Decimal('599.90'),
  branchId: BRANCH_ID,
  createdAt: new Date('2026-11-19T10:00:00.000Z'),
  updatedAt: new Date('2026-11-19T10:00:00.000Z'),
};

const storedBranch = (internetProvider: typeof provider | null) => ({
  id: BRANCH_ID,
  name: 'Centro',
  address: {},
  state: {},
  schedules: [],
  internetProvider,
});

describe('BranchesService (internet provider)', () => {
  let service: BranchesService;
  let prisma: {
    branch: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    service: { findMany: jest.Mock };
    branchInternetProvider: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      branch: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      service: { findMany: jest.fn().mockResolvedValue([]) },
      branchInternetProvider: { deleteMany: jest.fn() },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BranchesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(BranchesService);
  });

  it('creates the branch with a nested provider and returns a numeric price', async () => {
    prisma.branch.findUnique.mockResolvedValue(null);
    prisma.branch.create.mockResolvedValue(storedBranch(provider));

    const result = await service.create({
      name: 'Centro',
      urlResults: 'https://r.mx',
      stateId: 1,
      address: { zipCode: '1', extNumber: '1', street: 's', city: 'c' },
      internetProvider: {
        nameProvider: 'Telmex',
        accountNumber: '123456',
        monthlyPrice: 599.9,
      },
    });

    expect(prisma.branch.create.mock.calls[0][0].data.internetProvider).toEqual(
      {
        create: {
          nameProvider: 'Telmex',
          accountNumber: '123456',
          monthlyPrice: 599.9,
        },
      },
    );
    expect(result.internetProvider?.monthlyPrice).toBe(599.9);
  });

  it('creates the branch without provider when omitted', async () => {
    prisma.branch.findUnique.mockResolvedValue(null);
    prisma.branch.create.mockResolvedValue(storedBranch(null));

    const result = await service.create({
      name: 'Centro',
      urlResults: 'https://r.mx',
      stateId: 1,
      address: { zipCode: '1', extNumber: '1', street: 's', city: 'c' },
    });

    expect(
      prisma.branch.create.mock.calls[0][0].data.internetProvider,
    ).toBeUndefined();
    expect(result.internetProvider).toBeNull();
  });

  it('upserts the provider on update', async () => {
    prisma.branch.findUnique.mockResolvedValue(storedBranch(null));
    prisma.branch.update.mockResolvedValue(storedBranch(provider));

    const dto = {
      nameProvider: 'Telmex',
      accountNumber: '123456',
      monthlyPrice: 599.9,
    };
    await service.update(BRANCH_ID, { internetProvider: dto });

    expect(prisma.branchInternetProvider.deleteMany).not.toHaveBeenCalled();
    expect(prisma.branch.update.mock.calls[0][0].data.internetProvider).toEqual(
      { upsert: { create: dto, update: dto } },
    );
  });

  it('removes the provider when null is sent', async () => {
    prisma.branch.findUnique.mockResolvedValue(storedBranch(provider));
    prisma.branch.update.mockResolvedValue(storedBranch(null));

    const result = await service.update(BRANCH_ID, { internetProvider: null });

    expect(prisma.branchInternetProvider.deleteMany).toHaveBeenCalledWith({
      where: { branchId: BRANCH_ID },
    });
    expect(
      prisma.branch.update.mock.calls[0][0].data.internetProvider,
    ).toBeUndefined();
    expect(result.internetProvider).toBeNull();
  });

  it('returns the provider or null, and 404 for unknown branch', async () => {
    prisma.branch.findUnique.mockResolvedValueOnce({
      internetProvider: provider,
    });
    await expect(service.findInternetProvider(BRANCH_ID)).resolves.toEqual(
      expect.objectContaining({ nameProvider: 'Telmex', monthlyPrice: 599.9 }),
    );

    prisma.branch.findUnique.mockResolvedValueOnce({ internetProvider: null });
    await expect(service.findInternetProvider(BRANCH_ID)).resolves.toBeNull();

    prisma.branch.findUnique.mockResolvedValueOnce(null);
    await expect(service.findInternetProvider(BRANCH_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
