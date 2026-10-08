import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { StudiesService } from './studies.service';
import { CreateStudyDto } from './dto/create-study.dto';

const BRANCH_ID = 'branch-1';
const user = { branches: [{ id: BRANCH_ID }] };
const outsider = { branches: [{ id: 'other-branch' }] };

const uniqueViolation = (fields: string[]) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: fields },
  });

const catalogDelegate = () => ({
  findUnique: jest.fn(({ where }: { where: { id: number } }) =>
    Promise.resolve({
      id: where.id,
      name: `Catálogo ${where.id}`,
      branchId: BRANCH_ID,
      isActive: true,
    }),
  ),
});

describe('StudiesService', () => {
  let service: StudiesService;
  let prisma: {
    service: { findUnique: jest.Mock };
    priceSheets: { findMany: jest.Mock };
    study: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    studyPanelItem: { count: jest.Mock; findMany: jest.Mock };
    studyOnPriceSheet: { findMany: jest.Mock };
    studySection: ReturnType<typeof catalogDelegate>;
    sampleType: ReturnType<typeof catalogDelegate>;
    studyTechnique: ReturnType<typeof catalogDelegate>;
    $transaction: jest.Mock;
  };

  const baseDto: CreateStudyDto = {
    name: 'Glucosa',
    code: 'GLU',
    serviceId: 'svc-1',
    branchId: BRANCH_ID,
    sectionId: 1,
    sampleTypeId: 2,
    techniqueId: 3,
  };

  const createData = () =>
    (prisma.study.create.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;

  beforeEach(async () => {
    prisma = {
      service: {
        findUnique: jest.fn().mockResolvedValue({ branchId: BRANCH_ID }),
      },
      priceSheets: {
        findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            where.id.in.map((id) => ({ id, branchId: BRANCH_ID })),
          ),
        ),
      },
      study: {
        create: jest.fn().mockResolvedValue({ id: 'study-1' }),
        update: jest.fn().mockResolvedValue({ id: 'study-1' }),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      studyPanelItem: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      studyOnPriceSheet: { findMany: jest.fn().mockResolvedValue([]) },
      studySection: catalogDelegate(),
      sampleType: catalogDelegate(),
      studyTechnique: catalogDelegate(),
      $transaction: jest.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [StudiesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(StudiesService);
  });

  describe('create', () => {
    it.each([
      [{ units: 'mg/dL' }, 'units'],
      [{ decimals: 2 }, 'decimals'],
      [{ units: 'mg/dL', decimals: 0 }, 'units ni decimals'],
      [{ referenceValues: [{ text: 'NEGATIVO' }] }, 'referenceValues'],
    ])('rechaza un perfil con %j', async (measurement, fields) => {
      await expect(
        service.create({ ...baseDto, isPanel: true, ...measurement }, user),
      ).rejects.toThrow(
        `Un perfil (isPanel = true) no puede tener ${fields}: solo aplican a estudios individuales (los hijos del perfil)`,
      );
      expect(prisma.study.create).not.toHaveBeenCalled();
    });

    it('permite un perfil con referenceValues vacío', async () => {
      await service.create(
        { ...baseDto, isPanel: true, referenceValues: [] },
        user,
      );

      expect(prisma.study.create).toHaveBeenCalled();
    });

    it('devuelve eligiblePatients agrupado', async () => {
      prisma.study.create.mockResolvedValue({
        id: 'study-1',
        name: 'Glucosa',
        gender: 'F',
        ageFormat: 'AÑOS',
        minAge: 18,
        maxAge: 120,
      });

      await expect(service.create(baseDto, user)).resolves.toEqual({
        id: 'study-1',
        name: 'Glucosa',
        eligiblePatients: {
          gender: 'F',
          ageFormat: 'AÑOS',
          minAge: 18,
          maxAge: 120,
        },
      });
    });

    it('guarda units y decimals de un estudio individual', async () => {
      await service.create({ ...baseDto, units: 'mg/dL', decimals: 1 }, user);

      expect(createData()).toMatchObject({ units: 'mg/dL', decimals: 1 });
    });

    it('aplana eligiblePatients en las columnas del estudio', async () => {
      await service.create(
        {
          ...baseDto,
          eligiblePatients: { gender: 'F', ageFormat: 'AÑOS', minAge: 18 },
        },
        user,
      );

      expect(createData()).toMatchObject({
        gender: 'F',
        ageFormat: 'AÑOS',
        minAge: 18,
        maxAge: undefined,
      });
      expect(createData()).not.toHaveProperty('eligiblePatients');
    });

    it('rechaza eligiblePatients con minAge > maxAge, incluso contra el default de 120', async () => {
      await expect(
        service.create({ ...baseDto, eligiblePatients: { minAge: 130 } }, user),
      ).rejects.toThrow(
        'eligiblePatients: la edad mínima no puede ser mayor que la edad máxima',
      );
    });

    it('crea valores de referencia cuantitativos y cualitativos en el mismo write', async () => {
      await service.create(
        {
          ...baseDto,
          referenceValues: [
            { minValue: 70, maxValue: 99.5, date: '2026-10-01' },
            { text: ' NEGATIVO ' },
          ],
        },
        user,
      );

      const { referenceValues } = createData() as {
        referenceValues: { create: Record<string, unknown>[] };
      };
      expect(referenceValues.create).toEqual([
        {
          order: 0,
          gender: 'AMBOS',
          unitAge: 'Años',
          minAge: 0,
          maxAge: 120,
          minValue: new Prisma.Decimal(70),
          maxValue: new Prisma.Decimal(99.5),
          date: new Date('2026-10-01'),
        },
        { order: 1, text: 'NEGATIVO', date: undefined },
      ]);
    });

    it.each([
      [
        { text: 'NEGATIVO', minValue: 1 },
        'referenceValues[0]: un valor cualitativo (text) no puede incluir minValue',
      ],
      [
        { gender: 'AMBOS' as const },
        'referenceValues[0]: indica text (cualitativo) o al menos minValue/maxValue (cuantitativo)',
      ],
      [
        { minValue: 10, maxValue: 5 },
        'referenceValues[0]: minValue no puede ser mayor que maxValue',
      ],
      [
        { minValue: 1, minAge: 50, maxAge: 18 },
        'referenceValues[0]: minAge no puede ser mayor que maxAge',
      ],
    ])('rechaza el valor de referencia %j', async (value, message) => {
      await expect(
        service.create({ ...baseDto, referenceValues: [value] }, user),
      ).rejects.toThrow(new BadRequestException(message));
    });

    it('rechaza studyPrices que repiten tarifario', async () => {
      await expect(
        service.create(
          {
            ...baseDto,
            studyPrices: [
              { priceSheetId: 'ps-1', price: 100 },
              { priceSheetId: 'ps-1', price: 120 },
            ],
          },
          user,
        ),
      ).rejects.toThrow(
        'studyPrices no puede repetir la misma lista de precios',
      );
    });

    it('genera el slug desde name si no se envía', async () => {
      await service.create({ ...baseDto, name: 'Glucosa en Ayuno' }, user);

      expect(createData()).toMatchObject({ slug: 'glucosa-en-ayuno' });
    });

    it('respeta un slug explícito normalizándolo', async () => {
      await service.create({ ...baseDto, slug: '  Glucosa Sérica 2!  ' }, user);

      expect(createData()).toMatchObject({ slug: 'glucosa-serica-2' });
    });

    it('rechaza un slug que queda vacío al normalizarlo', async () => {
      await expect(
        service.create({ ...baseDto, slug: '!!!' }, user),
      ).rejects.toThrow('El slug no puede quedar vacío: usa letras o números');
    });

    it.each([
      [
        ['branch_id', 'code'],
        "Ya existe un estudio con el código 'GLU' en esta sucursal",
      ],
      [
        ['branch_id', 'slug'],
        "Ya existe un estudio con el slug 'glucosa' en esta sucursal: envía un slug distinto",
      ],
    ])('traduce el conflicto único %j a español', async (fields, message) => {
      prisma.study.create.mockRejectedValue(uniqueViolation(fields));

      await expect(service.create(baseDto, user)).rejects.toThrow(
        new ConflictException(message),
      );
    });

    it('usa el género correcto en el mensaje de catálogo de otra sucursal', async () => {
      prisma.sampleType.findUnique.mockResolvedValue({
        id: 2,
        name: 'Suero',
        branchId: 'other-branch',
        isActive: true,
      });

      await expect(service.create(baseDto, user)).rejects.toThrow(
        'El tipo de muestra seleccionado pertenece a otra sucursal',
      );
    });
  });

  describe('update', () => {
    const existing = {
      id: 'study-1',
      branchId: BRANCH_ID,
      serviceId: 'svc-1',
      isPanel: false,
      minAge: 0,
      maxAge: 120,
      sectionId: 1,
      sampleTypeId: 2,
      techniqueId: 3,
      code: 'GLU',
      slug: 'glucosa',
      units: 'mg/dL',
      decimals: 2,
      _count: { referenceValues: 0 },
    };

    const updateData = () =>
      (
        prisma.study.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;

    it('limpia units y decimals al marcar el estudio como perfil', async () => {
      prisma.study.findUnique.mockResolvedValue(existing);

      await service.update('study-1', { isPanel: true }, user);

      expect(updateData()).toMatchObject({
        isPanel: true,
        units: null,
        decimals: null,
      });
    });

    it('no permite marcar como perfil un estudio con valores de referencia guardados', async () => {
      prisma.study.findUnique.mockResolvedValue({
        ...existing,
        _count: { referenceValues: 2 },
      });

      await expect(
        service.update('study-1', { isPanel: true }, user),
      ).rejects.toThrow(
        'No se puede marcar como perfil: tiene 2 valor(es) de referencia. Envía referenceValues: [] para eliminarlos.',
      );
      expect(prisma.study.update).not.toHaveBeenCalled();
    });

    it('permite marcarlo como perfil si en el mismo request vacía referenceValues', async () => {
      prisma.study.findUnique.mockResolvedValue({
        ...existing,
        _count: { referenceValues: 2 },
      });

      await service.update(
        'study-1',
        { isPanel: true, referenceValues: [] },
        user,
      );

      expect(updateData()).toMatchObject({
        isPanel: true,
        referenceValues: { deleteMany: {}, create: [] },
      });
    });

    it('rechaza referenceValues en un perfil existente', async () => {
      prisma.study.findUnique.mockResolvedValue({ ...existing, isPanel: true });

      await expect(
        service.update(
          'study-1',
          { referenceValues: [{ text: 'NEGATIVO' }] },
          user,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza units en un perfil existente', async () => {
      prisma.study.findUnique.mockResolvedValue({ ...existing, isPanel: true });

      await expect(
        service.update('study-1', { units: 'mg/dL' }, user),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.study.update).not.toHaveBeenCalled();
    });

    it('valida eligiblePatients contra la edad guardada', async () => {
      prisma.study.findUnique.mockResolvedValue({ ...existing, maxAge: 18 });

      await expect(
        service.update('study-1', { eligiblePatients: { minAge: 30 } }, user),
      ).rejects.toThrow(
        'eligiblePatients: la edad mínima no puede ser mayor que la edad máxima',
      );
    });

    it('reemplaza la lista completa de valores de referencia', async () => {
      prisma.study.findUnique.mockResolvedValue(existing);

      await service.update(
        'study-1',
        {
          referenceValues: [{ text: 'NO REACTIVO' }],
        },
        user,
      );

      expect(updateData()).toMatchObject({
        referenceValues: {
          deleteMany: {},
          create: [{ order: 0, text: 'NO REACTIVO', date: undefined }],
        },
      });
    });

    it('no toca los valores de referencia si no se envían', async () => {
      prisma.study.findUnique.mockResolvedValue(existing);

      await service.update('study-1', { name: 'Glucosa en ayuno' }, user);

      expect(updateData()).not.toHaveProperty('referenceValues');
    });

    it('no desactiva por PATCH un estudio que forma parte de un perfil', async () => {
      prisma.study.findUnique.mockResolvedValue({
        ...existing,
        isActive: true,
      });
      prisma.studyPanelItem.findMany.mockResolvedValue([
        { panel: { code: 'PERFIL1' } },
      ]);

      await expect(
        service.update('study-1', { isActive: false }, user),
      ).rejects.toThrow(/forma parte de los perfiles PERFIL1/);
    });

    it('cambiar name no regenera el slug', async () => {
      prisma.study.findUnique.mockResolvedValue(existing);

      await service.update('study-1', { name: 'Glucosa en ayuno' }, user);

      expect(updateData()).toMatchObject({ name: 'Glucosa en ayuno' });
      expect(updateData()).not.toHaveProperty('slug');
    });

    it('cambia el slug solo si se envía explícito', async () => {
      prisma.study.findUnique.mockResolvedValue(existing);

      await service.update('study-1', { slug: 'Glucosa Basal' }, user);

      expect(updateData()).toMatchObject({ slug: 'glucosa-basal' });
    });

    it('responde 404 en español si el estudio no existe', async () => {
      prisma.study.findUnique.mockResolvedValue(null);

      await expect(service.update('nope', { name: 'X' }, user)).rejects.toThrow(
        new NotFoundException('Estudio con el ID nope no encontrado'),
      );
    });

    it('en conflicto de código usa el código guardado si no cambia', async () => {
      prisma.study.findUnique.mockResolvedValue(existing);
      prisma.study.update.mockRejectedValue(uniqueViolation(['code']));

      await expect(
        service.update('study-1', { name: 'Glucosa en ayuno' }, user),
      ).rejects.toThrow(
        "Ya existe un estudio con el código 'GLU' en esta sucursal",
      );
    });
  });

  describe('acceso por sucursal', () => {
    it('create rechaza una sucursal no asignada al usuario', async () => {
      await expect(service.create(baseDto, outsider)).rejects.toThrow(
        new ForbiddenException('No tienes acceso a esta sucursal'),
      );
      expect(prisma.study.create).not.toHaveBeenCalled();
    });

    it.each([
      ['update', (u: typeof user) => service.update('study-1', {}, u)],
      ['remove', (u: typeof user) => service.remove('study-1', u)],
      [
        'setPanelItems',
        (u: typeof user) => service.setPanelItems('study-1', { items: [] }, u),
      ],
      [
        'assignPriceSheet',
        (u: typeof user) =>
          service.assignPriceSheet(
            'study-1',
            { priceSheetId: 'ps-1', price: 10 },
            u,
          ),
      ],
      [
        'removePriceSheet',
        (u: typeof user) => service.removePriceSheet('study-1', 'ps-1', u),
      ],
    ])('%s rechaza un estudio de otra sucursal', async (_name, action) => {
      prisma.study.findUnique.mockResolvedValue({
        id: 'study-1',
        branchId: BRANCH_ID,
        _count: { referenceValues: 0 },
      });

      await expect(action(outsider)).rejects.toThrow(ForbiddenException);
      expect(prisma.study.update).not.toHaveBeenCalled();
    });

    it('exportByBranch rechaza una sucursal no asignada', async () => {
      await expect(service.exportByBranch(BRANCH_ID, outsider)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('findInactive limita a las sucursales del usuario', async () => {
      await service.findInactive(
        {},
        { branches: [{ id: BRANCH_ID }, { id: 'b2' }] },
      );

      expect(
        (prisma.study.findMany.mock.calls[0][0] as { where: unknown }).where,
      ).toEqual({ isActive: false, branchId: { in: [BRANCH_ID, 'b2'] } });
    });
  });

  describe('remove', () => {
    it('no desactiva un estudio que forma parte de un perfil', async () => {
      prisma.study.findUnique.mockResolvedValue({
        id: 'study-1',
        branchId: BRANCH_ID,
      });
      prisma.studyPanelItem.findMany.mockResolvedValue([
        { panel: { code: 'PERFIL1' } },
      ]);

      await expect(service.remove('study-1', user)).rejects.toThrow(
        'No se puede desactivar: el estudio forma parte de los perfiles PERFIL1. Quítalo de esos perfiles primero.',
      );
      expect(prisma.study.update).not.toHaveBeenCalled();
    });

    it('desactiva el estudio en lugar de borrarlo', async () => {
      prisma.study.findUnique.mockResolvedValue({
        id: 'study-1',
        branchId: BRANCH_ID,
      });

      await service.remove('study-1', user);

      expect(prisma.study.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'study-1' },
          data: { isActive: false },
        }),
      );
    });
  });

  describe('findBySlug', () => {
    it('busca por slug dentro de la sucursal y solo activos', async () => {
      prisma.study.findUnique.mockResolvedValue(null);

      await expect(service.findBySlug('glucosa', BRANCH_ID)).rejects.toThrow(
        "Estudio con el slug 'glucosa' no encontrado en esta sucursal",
      );
      expect(prisma.study.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            branchId_slug: { branchId: BRANCH_ID, slug: 'glucosa' },
            isActive: true,
          },
        }),
      );
    });
  });

  describe('findOrderable', () => {
    const where = () =>
      (prisma.study.findMany.mock.calls[0][0] as { where: unknown }).where;

    it('solo devuelve estudios activos con precio en una lista activa', async () => {
      await service.findOrderable({ branchId: BRANCH_ID });

      expect(where()).toEqual({
        branchId: BRANCH_ID,
        isActive: true,
        priceSheets: { some: { priceSheet: { isActive: true } } },
      });
    });

    it('con priceSheetId exige precio en esa lista', async () => {
      await service.findOrderable({ priceSheetId: 'ps-1' });

      expect(where()).toMatchObject({
        priceSheets: {
          some: { priceSheet: { isActive: true }, priceSheetId: 'ps-1' },
        },
      });
    });

    it('findAll solo devuelve activos y no filtra por precio', async () => {
      await service.findAll({ branchId: BRANCH_ID });

      expect(where()).toEqual({ branchId: BRANCH_ID, isActive: true });
    });

    it('findInactive solo devuelve inactivos', async () => {
      await service.findInactive({ branchId: BRANCH_ID }, user);

      expect(where()).toEqual({ branchId: BRANCH_ID, isActive: false });
    });

    it('mapea los filtros de pacientes elegibles a sus columnas', async () => {
      await service.findAll({
        gender: 'F',
        ageFormat: 'AÑOS',
        minAge: 18,
        maxAge: 65,
      });

      expect(where()).toEqual({
        isActive: true,
        gender: 'F',
        ageFormat: 'AÑOS',
        minAge: { gte: 18 },
        maxAge: { lte: 65 },
      });
    });

    it('acepta sort y filters con eligiblePatients.<campo>', async () => {
      await service.findAll({
        sort: { field: 'eligiblePatients.minAge', order: 'desc' },
        filters: {
          and: [
            { field: 'eligiblePatients.gender', operator: 'eq', value: 'M' },
          ],
        },
      });

      const args = prisma.study.findMany.mock.calls[0][0] as {
        where: unknown;
        orderBy: unknown;
      };
      expect(args.orderBy).toEqual({ minAge: 'desc' });
      expect(args.where).toMatchObject({ AND: [{ gender: 'M' }] });
    });
  });
});
