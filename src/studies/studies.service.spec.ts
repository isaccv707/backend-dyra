import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
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
    priceSheets: { findMany: jest.Mock; findFirst: jest.Mock };
    study: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    studyPanelItem: { count: jest.Mock; findMany: jest.Mock };
    studyProvider: { findMany: jest.Mock };
    studyOnPriceSheet: { findMany: jest.Mock; findFirst: jest.Mock };
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
        findFirst: jest.fn().mockResolvedValue({ id: 'ps-1' }),
      },
      study: {
        create: jest.fn().mockResolvedValue({ id: 'study-1' }),
        update: jest.fn().mockResolvedValue({ id: 'study-1' }),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      studyPanelItem: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      studyProvider: { findMany: jest.fn().mockResolvedValue([]) },
      studyOnPriceSheet: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
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

    it('crea un estudio sin técnica', async () => {
      await service.create({ ...baseDto, techniqueId: undefined }, user);

      expect(createData()).toMatchObject({
        section: { connect: { id: 1 } },
        sampleType: { connect: { id: 2 } },
        technique: undefined,
      });
    });

    it('guarda name en formato título y genera title y slug desde él', async () => {
      await service.create(
        { ...baseDto, name: 'HEMOGLOBINA glicosilada' },
        user,
      );

      expect(createData()).toMatchObject({
        name: 'Hemoglobina Glicosilada',
        title: 'Hemoglobina Glicosilada',
        slug: 'hemoglobina-glicosilada',
      });
    });

    it('usa name como title si no se envía', async () => {
      await service.create(baseDto, user);

      expect(prisma.study.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: baseDto.name }),
        }),
      );
    });

    it('guarda un title distinto de name', async () => {
      await service.create({ ...baseDto, title: 'Glucosa en ayuno' }, user);

      expect(prisma.study.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Glucosa en ayuno' }),
        }),
      );
    });

    it('devuelve eligiblePatients agrupado', async () => {
      prisma.study.create.mockResolvedValue({
        id: 'study-1',
        name: 'Glucosa',
        title: null,
        gender: 'F',
        ageFormat: 'AÑOS',
        minAge: 18,
        maxAge: 120,
      });

      await expect(service.create(baseDto, user)).resolves.toEqual({
        id: 'study-1',
        name: 'Glucosa',
        title: 'Glucosa',
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
      isInternal: true,
      providerId: null,
      _count: { referenceValues: 0 },
    };

    const updateData = () =>
      (
        prisma.study.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;

    it('quita la técnica con techniqueId: null', async () => {
      prisma.study.findUnique.mockResolvedValue(existing);

      await service.update('study-1', { techniqueId: null }, user);

      expect(updateData()).toMatchObject({ technique: { disconnect: true } });
    });

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

      expect(updateData()).toMatchObject({ name: 'Glucosa En Ayuno' });
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

  describe('maquila (isInternal)', () => {
    const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';
    const existing = {
      id: 'study-1',
      branchId: BRANCH_ID,
      isPanel: false,
      isActive: true,
      minAge: 0,
      maxAge: 120,
      code: 'GLU',
      slug: 'glucosa',
      isInternal: true,
      providerId: null,
      _count: { referenceValues: 0 },
    };
    const externalStudy = {
      ...existing,
      isInternal: false,
      providerId: PROVIDER_ID,
    };
    const provider = (overrides: Record<string, unknown> = {}) => ({
      id: PROVIDER_ID,
      name: 'Lab Externo',
      branchId: BRANCH_ID,
      isActive: true,
      ...overrides,
    });

    const updateData = () =>
      (
        prisma.study.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;

    beforeEach(() => {
      prisma.studyProvider.findMany.mockResolvedValue([provider()]);
    });

    it('por defecto crea el estudio como interno y sin maquilador', async () => {
      await service.create(baseDto, user);

      expect(createData()).toMatchObject({ providerCost: null });
      expect(createData()).not.toHaveProperty('provider');
      expect(prisma.studyProvider.findMany).not.toHaveBeenCalled();
    });

    it('enlaza el maquilador y guarda el costo de un estudio maquilado', async () => {
      await service.create(
        {
          ...baseDto,
          isInternal: false,
          providerId: PROVIDER_ID,
          providerCost: 150.5,
        },
        user,
      );

      expect(createData()).toMatchObject({
        isInternal: false,
        provider: { connect: { id: PROVIDER_ID } },
        providerCost: new Prisma.Decimal(150.5),
      });
    });

    it('rechaza un maquilado sin providerId', async () => {
      await expect(
        service.create({ ...baseDto, isInternal: false }, user),
      ).rejects.toThrow('requiere providerId');
      expect(prisma.study.create).not.toHaveBeenCalled();
    });

    it.each([
      [{ branchId: 'other-branch' }, 'pertenece a otra sucursal'],
      [{ isActive: false }, 'está inactivo'],
    ])('rechaza un maquilador %o', async (overrides, message) => {
      prisma.studyProvider.findMany.mockResolvedValue([provider(overrides)]);

      await expect(
        service.create(
          { ...baseDto, isInternal: false, providerId: PROVIDER_ID },
          user,
        ),
      ).rejects.toThrow(message);
    });

    it('responde 404 si el maquilador no existe', async () => {
      prisma.studyProvider.findMany.mockResolvedValue([]);

      await expect(
        service.create(
          { ...baseDto, isInternal: false, providerId: PROVIDER_ID },
          user,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([
      [{ providerId: PROVIDER_ID }, 'providerId'],
      [{ providerCost: 100 }, 'providerCost'],
    ])('rechaza %o en un estudio interno', async (extra, field) => {
      await expect(
        service.create({ ...baseDto, ...extra }, user),
      ).rejects.toThrow(`no puede tener ${field}`);
    });

    it('al volverlo interno desconecta el maquilador y limpia el costo', async () => {
      prisma.study.findUnique.mockResolvedValue(externalStudy);

      await service.update('study-1', { isInternal: true }, user);

      expect(updateData()).toMatchObject({
        isInternal: true,
        provider: { disconnect: true },
        providerCost: null,
      });
    });

    it('un maquilado existente puede cambiar solo el costo', async () => {
      prisma.study.findUnique.mockResolvedValue(externalStudy);

      await service.update('study-1', { providerCost: 90 }, user);

      expect(updateData()).toMatchObject({
        providerCost: new Prisma.Decimal(90),
      });
      expect(updateData()).not.toHaveProperty('provider');
      expect(prisma.studyProvider.findMany).not.toHaveBeenCalled();
    });

    it('valida el maquilador nuevo al cambiarlo', async () => {
      const otherId = '44444444-4444-4444-8444-444444444444';
      prisma.study.findUnique.mockResolvedValue(externalStudy);
      prisma.studyProvider.findMany.mockResolvedValue([
        provider({ id: otherId }),
      ]);

      await service.update('study-1', { providerId: otherId }, user);

      expect(updateData()).toMatchObject({
        provider: { connect: { id: otherId } },
      });
    });

    it('providerCost: null quita el costo', async () => {
      prisma.study.findUnique.mockResolvedValue(externalStudy);

      await service.update('study-1', { providerCost: null }, user);

      expect(updateData()).toMatchObject({ providerCost: null });
    });

    it('rechaza marcar como maquilado sin maquilador', async () => {
      prisma.study.findUnique.mockResolvedValue(existing);

      await expect(
        service.update('study-1', { isInternal: false }, user),
      ).rejects.toThrow('requiere providerId');
    });

    it('las lecturas públicas no exponen datos de maquila', async () => {
      const study = {
        ...externalStudy,
        provider: { id: PROVIDER_ID, name: 'Lab Externo' },
        title: null,
        name: 'Glucosa',
        gender: 'A',
        ageFormat: 'AÑOS',
        providerCost: new Prisma.Decimal(90),
        service: {
          id: 'svc-1',
          name: 'Análisis',
          slug: 'a',
          priceSheetId: null,
        },
      };
      prisma.study.findFirst.mockResolvedValue(study);
      prisma.study.findMany.mockResolvedValue([study]);

      const detail = await service.findOne('study-1');
      const { data } = await service.findAll({
        isInternal: false,
        providerId: PROVIDER_ID,
      });

      for (const result of [detail, data[0]]) {
        expect(result).not.toHaveProperty('isInternal');
        expect(result).not.toHaveProperty('providerId');
        expect(result).not.toHaveProperty('provider');
        expect(result).not.toHaveProperty('providerCost');
      }
      expect(prisma.study.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            isInternal: false,
          }) as unknown,
        }),
      );
      expect(prisma.study.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            providerId: PROVIDER_ID,
          }) as unknown,
        }),
      );
    });

    it('findAdminActive solo trae activos de las sucursales del usuario', async () => {
      await service.findAdminActive(
        { isInternal: false, providerId: PROVIDER_ID },
        user,
      );

      expect(prisma.study.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            isInternal: false,
            providerId: PROVIDER_ID,
            branchId: { in: [BRANCH_ID] },
          }) as unknown,
        }),
      );
    });

    it('el listado admin conserva el maquilador', async () => {
      prisma.study.findMany.mockResolvedValue([
        {
          ...externalStudy,
          provider: { id: PROVIDER_ID, name: 'Lab Externo' },
          title: null,
          name: 'Glucosa',
          gender: 'A',
          ageFormat: 'AÑOS',
          service: { priceSheetId: null },
        },
      ]);

      const { data } = await service.findInactive({ isInternal: false }, user);

      expect(data[0]).toMatchObject({
        provider: { id: PROVIDER_ID, name: 'Lab Externo' },
      });
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

    it('exportByBranch incluye toda la información del estudio', async () => {
      Object.assign(prisma, {
        branch: {
          findUnique: jest.fn().mockResolvedValue({ name: 'Centro' }),
        },
      });
      prisma.priceSheets.findMany.mockResolvedValue([
        { id: 'ps-1', name: 'Público', isActive: true },
      ]);
      prisma.study.findMany.mockResolvedValue([
        {
          id: 'study-1',
          code: 'GLU01',
          abbreviation: 'GLU',
          name: 'Glucosa',
          title: 'Glucosa en ayuno',
          slug: 'glucosa',
          isActive: true,
          description: 'Glucosa en sangre',
          preparation: 'Ayuno de 8 horas',
          service: { name: 'Análisis Clínicos' },
          section: { name: 'Química clínica' },
          sampleType: { name: 'Suero' },
          technique: null,
          isPanel: false,
          panelItems: [],
          parentPanels: [{ panel: { code: 'QS6' } }],
          gender: 'A',
          ageFormat: 'AÑOS',
          minAge: 0,
          maxAge: 120,
          units: 'mg/dL',
          decimals: 1,
          deliveryTime: 1,
          createdAt: new Date('2026-01-02T00:00:00Z'),
          updatedAt: new Date('2026-03-04T00:00:00Z'),
          priceSheets: [
            {
              priceSheetId: 'ps-1',
              price: new Prisma.Decimal(120),
              showPrice: true,
            },
          ],
          referenceValues: [
            {
              order: 0,
              gender: 'AMBOS',
              unitAge: 'Años',
              minAge: 0,
              maxAge: 120,
              minValue: new Prisma.Decimal(70),
              maxValue: new Prisma.Decimal(100),
              text: null,
              date: new Date('2026-01-02T00:00:00Z'),
            },
          ],
        },
      ]);

      const { buffer, branchName } = await service.exportByBranch(
        BRANCH_ID,
        user,
      );
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const [studyRow] = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets['Estudios'],
      );
      const [referenceRow] = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets['Valores de referencia'],
      );

      expect(branchName).toBe('Centro');
      expect(studyRow).toMatchObject({
        Código: 'GLU01',
        Nombre: 'Glucosa',
        Título: 'Glucosa en ayuno',
        Servicio: 'Análisis Clínicos',
        'Forma parte de': 'QS6',
        Descripción: 'Glucosa en sangre',
        Preparación: 'Ayuno de 8 horas',
        'Precio: Público': 120,
        Creado: '2026-01-02',
        Actualizado: '2026-03-04',
      });
      expect(referenceRow).toMatchObject({
        'Código del estudio': 'GLU01',
        'Nombre del estudio': 'Glucosa',
        'Valor mínimo': 70,
        'Valor máximo': 100,
        Unidades: 'mg/dL',
      });
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

  describe('detalle público', () => {
    const detail = (priceSheetId: string | null) => ({
      id: 'study-1',
      name: 'Glucosa',
      title: null,
      gender: 'A',
      ageFormat: 'AÑOS',
      minAge: 0,
      maxAge: 120,
      service: {
        id: 'svc-1',
        name: 'Análisis',
        slug: 'analisis',
        priceSheetId,
      },
    });

    it.each([
      ['findBySlug', () => service.findBySlug('glucosa', BRANCH_ID)],
      ['findOne', () => service.findOne('study-1')],
    ])(
      '%s no incluye priceSheets y toma el precio de la lista pública del servicio',
      async (_name, call) => {
        prisma.study.findUnique.mockResolvedValue(detail('ps-1'));
        prisma.study.findFirst.mockResolvedValue(detail('ps-1'));
        prisma.studyOnPriceSheet.findFirst.mockResolvedValue({
          price: new Prisma.Decimal(473),
          showPrice: true,
        });

        const result = await call();

        const [args] = (prisma.study.findUnique.mock.calls[0] ??
          prisma.study.findFirst.mock.calls[0]) as [
          { include: Record<string, unknown> },
        ];
        expect(args.include).not.toHaveProperty('priceSheets');
        expect(result).not.toHaveProperty('priceSheets');
        expect(result.service).toEqual({
          id: 'svc-1',
          name: 'Análisis',
          slug: 'analisis',
        });
        expect(prisma.studyOnPriceSheet.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              studyId: 'study-1',
              priceSheetId: 'ps-1',
              priceSheet: { isPublic: true, isActive: true },
            },
          }),
        );
        expect(result.priceInfo).toEqual({
          showPrice: true,
          price: new Prisma.Decimal(473),
          message: null,
        });
      },
    );

    it('sin precio público (lista privada, inactiva o sin entrada) responde showPrice=false', async () => {
      prisma.study.findFirst.mockResolvedValue(detail('ps-1'));

      const result = await service.findOne('study-1');

      expect(result.priceInfo).toEqual({
        showPrice: false,
        price: null,
        message: 'Para mayor información consulte en sucursal',
      });
    });

    it('si el servicio no tiene lista asignada no consulta precios', async () => {
      prisma.study.findFirst.mockResolvedValue(detail(null));

      const result = await service.findOne('study-1');

      expect(prisma.studyOnPriceSheet.findFirst).not.toHaveBeenCalled();
      expect(result.priceInfo.showPrice).toBe(false);
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

    it('solo devuelve estudios activos con precio en una lista pública y activa', async () => {
      await service.findOrderable({ branchId: BRANCH_ID });

      expect(where()).toEqual({
        branchId: BRANCH_ID,
        isActive: true,
        priceSheets: {
          some: { priceSheet: { isPublic: true, isActive: true } },
        },
      });
    });

    it('con priceSheetId exige precio en esa lista', async () => {
      await service.findOrderable({ priceSheetId: 'ps-1' });

      expect(where()).toMatchObject({
        priceSheets: {
          some: {
            priceSheet: { isPublic: true, isActive: true },
            priceSheetId: 'ps-1',
          },
        },
      });
    });

    describe('findAdminOrderable', () => {
      it('acepta listas privadas activas y limita a las sucursales del usuario', async () => {
        prisma.priceSheets.findFirst.mockResolvedValue({ id: 'ps-private' });

        await service.findAdminOrderable({ priceSheetId: 'ps-private' }, user);

        expect(prisma.priceSheets.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: 'ps-private',
              isActive: true,
              branchId: { in: [BRANCH_ID] },
            },
          }),
        );
        expect(where()).toMatchObject({
          isActive: true,
          branchId: { in: [BRANCH_ID] },
          priceSheets: {
            some: {
              priceSheet: { isActive: true },
              priceSheetId: 'ps-private',
            },
          },
        });
      });

      it('responde 404 si la lista no existe, está inactiva o es de otra sucursal', async () => {
        prisma.priceSheets.findFirst.mockResolvedValue(null);

        await expect(
          service.findAdminOrderable({ priceSheetId: 'ps-x' }, user),
        ).rejects.toThrow(NotFoundException);
        expect(prisma.study.findMany).not.toHaveBeenCalled();
      });

      it('responde 403 con un branchId no asignado', async () => {
        await expect(
          service.findAdminOrderable({ branchId: BRANCH_ID }, outsider),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    it.each(['findAll', 'findOrderable'] as const)(
      '%s responde 404 con un priceSheetId privado o inactivo',
      async (method) => {
        prisma.priceSheets.findFirst.mockResolvedValue(null);

        await expect(
          service[method]({ priceSheetId: 'ps-private' }),
        ).rejects.toThrow(NotFoundException);
        expect(prisma.priceSheets.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'ps-private', isPublic: true, isActive: true },
          }),
        );
        expect(prisma.study.findMany).not.toHaveBeenCalled();
      },
    );

    it('findAll solo resuelve precios de listas públicas y no expone hasConfiguredPrice', async () => {
      prisma.study.findMany.mockResolvedValue([
        {
          id: 'study-1',
          name: 'Glucosa',
          title: null,
          gender: 'A',
          ageFormat: 'AÑOS',
          minAge: 0,
          maxAge: 120,
          service: { priceSheetId: 'ps-1' },
        },
      ]);
      prisma.studyOnPriceSheet.findMany.mockResolvedValue([
        {
          studyId: 'study-1',
          priceSheetId: 'ps-1',
          price: new Prisma.Decimal(473),
          showPrice: true,
        },
      ]);

      const { data } = await service.findAll({ branchId: BRANCH_ID });

      expect(prisma.studyOnPriceSheet.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          priceSheet: { isPublic: true, isActive: true },
        }) as unknown,
      });
      expect(data[0].priceInfo).toEqual({
        showPrice: true,
        price: new Prisma.Decimal(473),
        message: null,
      });
    });

    it('findInactive (admin) conserva hasConfiguredPrice y acepta cualquier lista', async () => {
      prisma.study.findMany.mockResolvedValue([
        {
          id: 'study-1',
          name: 'Glucosa',
          title: null,
          gender: 'A',
          ageFormat: 'AÑOS',
          minAge: 0,
          maxAge: 120,
          service: { priceSheetId: null },
        },
      ]);

      const { data } = await service.findInactive(
        { priceSheetId: 'ps-private' },
        user,
      );

      expect(prisma.priceSheets.findFirst).not.toHaveBeenCalled();
      expect(prisma.studyOnPriceSheet.findMany).toHaveBeenCalledWith({
        where: {
          priceSheetId: { in: ['ps-private'] },
          studyId: { in: ['study-1'] },
        },
      });
      expect(data[0].priceInfo).toMatchObject({ hasConfiguredPrice: false });
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

  describe('createMany (parámetros nuevos de un perfil grande)', () => {
    let batch: {
      serviceFindMany: jest.Mock;
      catalogFindMany: jest.Mock;
      studyCreateMany: jest.Mock;
      referenceCreateMany: jest.Mock;
      priceCreateMany: jest.Mock;
    };

    beforeEach(() => {
      batch = {
        serviceFindMany: jest.fn(
          ({ where }: { where: { id: { in: string[] } } }) =>
            Promise.resolve(
              where.id.in.map((id) => ({ id, branchId: BRANCH_ID })),
            ),
        ),
        catalogFindMany: jest.fn(
          ({ where }: { where: { id: { in: number[] } } }) =>
            Promise.resolve(
              where.id.in.map((id) => ({
                id,
                name: `Catálogo ${id}`,
                branchId: BRANCH_ID,
                isActive: true,
              })),
            ),
        ),
        studyCreateMany: jest.fn().mockResolvedValue({ count: 0 }),
        referenceCreateMany: jest.fn().mockResolvedValue({ count: 0 }),
        priceCreateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      Object.assign(prisma.service, { findMany: batch.serviceFindMany });
      for (const kind of [
        'studySection',
        'sampleType',
        'studyTechnique',
      ] as const) {
        Object.assign(prisma[kind], { findMany: batch.catalogFindMany });
      }
      Object.assign(prisma.study, { createMany: batch.studyCreateMany });
      Object.assign(prisma, {
        referenceValue: { createMany: batch.referenceCreateMany },
      });
      Object.assign(prisma.studyOnPriceSheet, {
        createMany: batch.priceCreateMany,
      });
    });

    const child = (i: number) => ({
      label: `form.panelItems[${i}].newStudy`,
      dto: {
        ...baseDto,
        name: `Parámetro ${i}`,
        code: `P${i}`,
        units: 'mg/dL',
        referenceValues: [{ minValue: 1, maxValue: 10 }],
        studyPrices: [{ priceSheetId: 'ps-1', price: 100 }],
      },
    });

    it('valida e inserta 200 estudios con un número fijo de consultas', async () => {
      const items = Array.from({ length: 200 }, (_, i) => child(i));

      const created = await service.createMany(items, user);

      expect(created).toHaveLength(200);
      expect(created[5]).toMatchObject({ code: 'P5', name: 'Parámetro 5' });
      expect(batch.serviceFindMany).toHaveBeenCalledTimes(1);
      // Una consulta por catálogo (sección, muestra, técnica), no por estudio.
      expect(batch.catalogFindMany).toHaveBeenCalledTimes(3);
      expect(prisma.priceSheets.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.study.findMany).toHaveBeenCalledTimes(1);
      expect(batch.studyCreateMany).toHaveBeenCalledTimes(1);
      expect(batch.referenceCreateMany).toHaveBeenCalledTimes(1);
      expect(batch.priceCreateMany).toHaveBeenCalledTimes(1);
      expect(prisma.study.create).not.toHaveBeenCalled();

      const rows = batch.studyCreateMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(200);
      expect(rows[0]).toMatchObject({
        id: created[0].id,
        branchId: BRANCH_ID,
        code: 'P0',
        slug: 'parametro-0',
        title: 'Parámetro 0',
        units: 'mg/dL',
      });
      expect(batch.referenceCreateMany.mock.calls[0][0].data[0]).toMatchObject({
        studyId: created[0].id,
        order: 0,
      });
    });

    it('rechaza códigos repetidos dentro de la solicitud', async () => {
      await expect(
        service.createMany(
          [child(1), { ...child(2), dto: { ...child(2).dto, code: 'P1' } }],
          user,
        ),
      ).rejects.toThrow('Códigos repetidos en la solicitud: P1');
      expect(batch.studyCreateMany).not.toHaveBeenCalled();
    });

    it('nombra el código que ya existe en la sucursal', async () => {
      prisma.study.findMany.mockResolvedValue([{ code: 'P2', slug: 'otro' }]);

      await expect(
        service.createMany([child(1), child(2)], user),
      ).rejects.toThrow(
        "Ya existe un estudio con el código 'P2' en esta sucursal",
      );
      expect(batch.studyCreateMany).not.toHaveBeenCalled();
    });

    it('indica qué parámetro tiene un catálogo de otra sucursal', async () => {
      batch.catalogFindMany.mockResolvedValueOnce([
        { id: 1, name: 'Química', branchId: 'otra', isActive: true },
      ]);

      await expect(
        service.createMany([child(0), child(1)], user),
      ).rejects.toThrow(
        'form.panelItems[0].newStudy: La sección seleccionada pertenece a otra sucursal',
      );
    });

    it('prefija con el parámetro los errores de reglas (rango de valores)', async () => {
      const bad = {
        ...child(3),
        dto: {
          ...child(3).dto,
          referenceValues: [{ minValue: 10, maxValue: 1 }],
        },
      };

      await expect(
        service.createMany([child(0), bad], user),
      ).rejects.toMatchObject({
        response: {
          message: [
            'form.panelItems[3].newStudy: referenceValues[0]: minValue no puede ser mayor que maxValue',
          ],
        },
      });
    });
  });
});
