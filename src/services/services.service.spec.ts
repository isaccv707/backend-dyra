import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { BranchesService } from 'src/branches/branches.service';
import { ServicesService } from './services.service';
import { ServiceAdminQueryService } from './services/service-admin-query.service';
import { ServicePublicQueryService } from './services/service-public-query.service';
import { ServiceWriteService } from './services/service-write.service';

const BRANCH_ID = 'branch-1';
const OTHER_BRANCH_ID = 'branch-2';
const user = { branches: [{ id: BRANCH_ID }] };

describe('ServicesService', () => {
  let service: ServicesService;
  let prisma: {
    priceSheets: { findFirst: jest.Mock };
    service: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      delete: jest.Mock;
      create: jest.Mock;
    };
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
        findUnique: jest.fn(),
        delete: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'svc-new' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      study: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      studyOnPriceSheet: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(
        (queries: Promise<unknown>[] | ((tx: unknown) => unknown)) =>
          typeof queries === 'function'
            ? queries({
                benefit: { deleteMany: jest.fn() },
                serviceDetail: { deleteMany: jest.fn() },
                service: {
                  update: jest.fn().mockResolvedValue({ id: 'svc-1' }),
                },
              })
            : Promise.all(queries),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        ServicesService,
        ServiceWriteService,
        ServicePublicQueryService,
        ServiceAdminQueryService,
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

    it('ordena los estudios de cada servicio por nombre', async () => {
      await service.findAll({ branchId: BRANCH_ID });
      expect(prisma.service.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            studies: expect.objectContaining({ orderBy: { name: 'asc' } }),
          }),
        }),
      );
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

  describe('admin', () => {
    const user = { branches: [{ id: BRANCH_ID }] };

    it('findAdminAll limita a las sucursales del usuario y cuenta todos los estudios', async () => {
      await service.findAdminAll({ isActive: false }, user);

      const args = prisma.service.findMany.mock.calls[0][0] as {
        where: { AND: unknown[] };
        include: { _count: unknown };
      };
      expect(args.where.AND[1]).toEqual({
        branchId: { in: [BRANCH_ID] },
        isActive: false,
      });
      expect(args.include._count).toEqual({ select: { studies: true } });
    });

    it('findAdminOne expone la lista privada y estudios sin precio', async () => {
      prisma.service.findUnique.mockResolvedValue({
        ...assignedService({ isPublic: false, isActive: false }),
        branchId: BRANCH_ID,
      });
      prisma.study.findMany.mockResolvedValue([
        {
          id: 'st-1',
          name: 'Glucosa',
          title: null,
          sampleType: null,
          section: null,
        },
        {
          id: 'st-2',
          name: 'Urea',
          title: 'Urea sérica',
          sampleType: null,
          section: null,
        },
      ]);
      prisma.study.count.mockResolvedValue(2);
      prisma.studyOnPriceSheet.findMany.mockResolvedValue([
        { studyId: 'st-1', priceSheetId: 'ps-1', price: 100, showPrice: false },
      ]);

      const result = await service.findAdminOne('svc-1', {}, user);

      expect(result.priceSheet).toMatchObject({ id: 'ps-1', isPublic: false });
      const where = (
        prisma.study.findMany.mock.calls[0][0] as { where: object }
      ).where;
      expect(where).toEqual({ serviceId: 'svc-1' });
      expect(result.studies.data.map((s) => s.priceInfo)).toEqual([
        { showPrice: false, price: 100, hasConfiguredPrice: true },
        { showPrice: false, price: null, hasConfiguredPrice: false },
      ]);
      expect(result.studies.data[0].title).toBe('Glucosa');
    });

    it('findAdminOne responde 403 si el servicio es de otra sucursal', async () => {
      prisma.service.findUnique.mockResolvedValue({
        ...assignedService({ isPublic: true, isActive: true }),
        branchId: 'other-branch',
      });

      await expect(service.findAdminOne('svc-1', {}, user)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('remove', () => {
    it('responde 409 si el servicio tiene estudios', async () => {
      prisma.service.findUnique.mockResolvedValue({
        id: 'svc-1',
        name: 'Análisis',
        branchId: BRANCH_ID,
        _count: { studies: 3 },
      });

      await expect(service.remove('svc-1', user)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.service.delete).not.toHaveBeenCalled();
    });

    it('elimina un servicio sin estudios', async () => {
      prisma.service.findUnique.mockResolvedValue({
        id: 'svc-1',
        name: 'Análisis',
        branchId: BRANCH_ID,
        _count: { studies: 0 },
      });

      await service.remove('svc-1', user);

      expect(prisma.service.delete).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
      });
    });
  });

  describe('escrituras acotadas a las sucursales del usuario', () => {
    const dto = {
      name: 'Rayos X',
      imageUrl: 'https://example.com/x.png',
      branchId: OTHER_BRANCH_ID,
    };
    const otherBranchService = {
      id: 'svc-1',
      name: 'Análisis',
      branchId: OTHER_BRANCH_ID,
      _count: { studies: 0 },
    };

    it('create responde 403 en una sucursal no asignada', async () => {
      await expect(service.create(dto, user)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.service.create).not.toHaveBeenCalled();
    });

    it('create permite su sucursal y a un usuario global', async () => {
      await service.create({ ...dto, branchId: BRANCH_ID }, user);
      await service.create(dto, { branches: [] });
      expect(prisma.service.create).toHaveBeenCalledTimes(2);
    });

    it('update responde 404 antes que 403 si el servicio no existe', async () => {
      prisma.service.findUnique.mockResolvedValue(null);
      await expect(
        service.update('svc-x', { description: 'x' }, user),
      ).rejects.toThrow(NotFoundException);
    });

    it('update responde 403 si el servicio es de otra sucursal', async () => {
      prisma.service.findUnique.mockResolvedValue(otherBranchService);
      await expect(
        service.update('svc-1', { description: 'x' }, user),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('update responde 403 al mover el servicio a una sucursal no asignada', async () => {
      prisma.service.findUnique.mockResolvedValue({
        ...otherBranchService,
        branchId: BRANCH_ID,
      });
      await expect(
        service.update('svc-1', { branchId: OTHER_BRANCH_ID }, user),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('update permite un servicio de su sucursal', async () => {
      prisma.service.findUnique.mockResolvedValue({
        ...otherBranchService,
        branchId: BRANCH_ID,
      });
      await expect(
        service.update(
          'svc-1',
          { description: 'x', branchId: BRANCH_ID },
          user,
        ),
      ).resolves.toEqual({ id: 'svc-1' });
    });

    it('remove responde 403 si el servicio es de otra sucursal', async () => {
      prisma.service.findUnique.mockResolvedValue(otherBranchService);
      await expect(service.remove('svc-1', user)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.service.delete).not.toHaveBeenCalled();
    });
  });
});
