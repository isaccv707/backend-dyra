import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { BranchesService } from 'src/branches/branches.service';
import { ServicesService } from './services.service';

const BRANCH_ID = 'branch-1';

describe('ServicesService', () => {
  let service: ServicesService;
  let prisma: {
    priceSheets: { findFirst: jest.Mock };
    service: { findFirst: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    study: { findMany: jest.Mock; count: jest.Mock };
    studyOnPriceSheet: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const assignedService = (priceSheet: {
    isPublic: boolean;
    isActive: boolean;
  }) => ({
    id: 'svc-1',
    name: 'Análisis',
    priceSheetId: 'ps-1',
    priceSheet: {
      id: 'ps-1',
      name: 'Ginemed 2026',
      description: 'Socio',
      ...priceSheet,
    },
  });

  beforeEach(async () => {
    prisma = {
      priceSheets: { findFirst: jest.fn().mockResolvedValue(null) },
      service: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      study: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      studyOnPriceSheet: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: BranchesService,
          useValue: { findOne: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = module.get(ServicesService);
  });

  describe('findAll por sucursal', () => {
    it('responde 404 si priceSheetId no es una lista pública y activa', async () => {
      await expect(
        service.findAll({ branchId: BRANCH_ID, priceSheetId: 'ps-private' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.priceSheets.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'ps-private',
            branchId: BRANCH_ID,
            isPublic: true,
            isActive: true,
          },
        }),
      );
      expect(prisma.service.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it.each([
      [{ isPublic: false, isActive: true }],
      [{ isPublic: true, isActive: false }],
    ])(
      'con la lista asignada %j no expone la lista ni estudios',
      async (sheet) => {
        prisma.service.findFirst.mockResolvedValue(assignedService(sheet));

        const result = await service.findOne('svc-1');

        expect(result.priceSheet).toBeNull();
        expect(result.studies.data).toEqual([]);
        expect(result.studies.total).toBe(0);
        expect(prisma.study.findMany).not.toHaveBeenCalled();
        expect(prisma.studyOnPriceSheet.findMany).not.toHaveBeenCalled();
      },
    );

    it('con lista pública y activa solo lista estudios con precio en ella', async () => {
      prisma.service.findFirst.mockResolvedValue(
        assignedService({ isPublic: true, isActive: true }),
      );

      const result = await service.findOne('svc-1');

      expect(result.priceSheet).toEqual({
        id: 'ps-1',
        name: 'Ginemed 2026',
        description: 'Socio',
      });
      expect(prisma.study.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            priceSheets: { some: { priceSheetId: 'ps-1' } },
          }) as unknown,
        }),
      );
    });

    it.each([true, false])(
      'con isPanel=%s filtra los estudios por tipo',
      async (isPanel) => {
        prisma.service.findFirst.mockResolvedValue(
          assignedService({ isPublic: true, isActive: true }),
        );

        await service.findOne('svc-1', { isPanel });

        const where = { isPanel };
        expect(prisma.study.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining(where) as unknown,
          }),
        );
        expect(prisma.study.count).toHaveBeenCalledWith({
          where: expect.objectContaining(where) as unknown,
        });
      },
    );

    it('devuelve descripción, preparación, tipo de muestra y sección del estudio', async () => {
      prisma.service.findFirst.mockResolvedValue(
        assignedService({ isPublic: true, isActive: true }),
      );
      prisma.study.findMany.mockResolvedValue([
        {
          id: 'st-1',
          name: 'Perfil tiroideo',
          code: 'PT01',
          slug: 'perfil-tiroideo',
          isPanel: true,
          description: 'Evalúa la tiroides',
          preparation: 'Ayuno de 8 horas',
          sampleType: { name: 'Suero' },
          section: { name: 'Hormonas' },
        },
      ]);
      prisma.study.count.mockResolvedValue(1);
      prisma.studyOnPriceSheet.findMany.mockResolvedValue([
        { studyId: 'st-1', priceSheetId: 'ps-1', price: 500, showPrice: true },
      ]);

      const result = await service.findOne('svc-1');

      expect(result.studies.data[0]).toEqual({
        id: 'st-1',
        name: 'Perfil tiroideo',
        code: 'PT01',
        slug: 'perfil-tiroideo',
        isPanel: true,
        description: 'Evalúa la tiroides',
        preparation: 'Ayuno de 8 horas',
        sampleType: 'Suero',
        section: 'Hormonas',
        priceInfo: { showPrice: true, price: 500, message: null },
      });
    });

    it('sin isPanel no filtra por tipo', async () => {
      prisma.service.findFirst.mockResolvedValue(
        assignedService({ isPublic: true, isActive: true }),
      );

      await service.findOne('svc-1');

      const [[args]] = prisma.study.findMany.mock.calls as [
        [{ where: Record<string, unknown> }],
      ];
      expect(args.where).not.toHaveProperty('isPanel');
    });
  });
});
