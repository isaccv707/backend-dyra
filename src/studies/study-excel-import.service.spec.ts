import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { StudyExcelImportService } from './study-excel-import.service';

type Row = Record<string, string | number>;

const toExcel = (rows: Row[]): Buffer => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    'Hoja',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const catalogDelegate = () => ({
  findMany: jest.fn(
    ({ where }: { where: { OR: { name: { equals: string } }[] } }) =>
      Promise.resolve(
        where.OR.map(({ name }, i) => ({ id: i + 1, name: name.equals })),
      ),
  ),
  createMany: jest.fn(),
});

describe('StudyExcelImportService.importStudies sin tarifario', () => {
  let service: StudyExcelImportService;
  let prisma: {
    service: { findMany: jest.Mock };
    study: { findMany: jest.Mock; upsert: jest.Mock };
    studyOnPriceSheet: { upsert: jest.Mock };
    studyPanelItem: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      createMany: jest.Mock;
    };
    studySection: ReturnType<typeof catalogDelegate>;
    sampleType: ReturnType<typeof catalogDelegate>;
    studyTechnique: ReturnType<typeof catalogDelegate>;
    $transaction: jest.Mock;
  };
  let existingStudies: Array<{
    code: string;
    isPanel?: boolean;
    isActive?: boolean;
    _count?: { referenceValues: number; parentPanels: number };
  }>;
  let existingSlugs: string[];
  const upsertedCodes: string[] = [];

  const branchId = 'branch-1';

  const row = (code: string, overrides: Row = {}): Row => ({
    code,
    name: `Estudio ${code}`,
    serviceName: 'Química',
    section: 'Química clínica',
    sampleType: 'Suero',
    technique: 'Colorimetría',
    ...overrides,
  });

  beforeEach(async () => {
    existingStudies = [];
    existingSlugs = [];
    upsertedCodes.length = 0;
    prisma = {
      service: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'svc-1', name: 'Química' }]),
      },
      study: {
        findMany: jest.fn(
          ({
            where,
            select,
          }: {
            where: { panelItems?: unknown };
            select: { id?: boolean; slug?: boolean };
          }) => {
            if (where.panelItems) return Promise.resolve([]);
            if (select.slug) {
              return Promise.resolve(existingSlugs.map((slug) => ({ slug })));
            }
            if (select.id) {
              return Promise.resolve(
                upsertedCodes.map((code) => ({
                  id: `study-${code}`,
                  code,
                  isActive: true,
                })),
              );
            }
            return Promise.resolve(existingStudies);
          },
        ),
        upsert: jest.fn(
          ({ where }: { where: { branchId_code: { code: string } } }) => {
            upsertedCodes.push(where.branchId_code.code);
            return Promise.resolve({ id: `study-${where.branchId_code.code}` });
          },
        ),
      },
      studyOnPriceSheet: { upsert: jest.fn() },
      studyPanelItem: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      studySection: catalogDelegate(),
      sampleType: catalogDelegate(),
      studyTechnique: catalogDelegate(),
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const module = await Test.createTestingModule({
      providers: [
        StudyExcelImportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(StudyExcelImportService);
  });

  it('crea estudios sin columna price y nunca toca tarifarios', async () => {
    existingStudies = [{ code: 'B2' }];

    const result = await service.importStudies(
      branchId,
      toExcel([row('a1'), row('B2', { price: '' })]),
    );

    expect(result.invalid).toEqual([]);
    expect(result).toMatchObject({ processed: 2, created: 1, updated: 1 });
    expect(prisma.studyOnPriceSheet.upsert).not.toHaveBeenCalled();
    expect(prisma.study.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { branchId_code: { branchId, code: 'A1' } },
        create: expect.objectContaining({
          slug: 'estudio-a1',
          branch: { connect: { id: branchId } },
        }),
      }),
    );
  });

  it('rechaza filas con price o showPrice capturado', async () => {
    const result = await service.importStudies(
      branchId,
      toExcel([
        row('A1', { price: 99 }),
        row('B2', { showPrice: 'false' }),
        row('C3'),
      ]),
    );

    expect(result.processed).toBe(1);
    expect(result.invalid).toEqual([
      {
        row: 2,
        code: 'A1',
        errors: [
          'Esta importación no asigna precios: deja vacía(s) la(s) columna(s) price o usa la importación del tarifario',
        ],
      },
      {
        row: 3,
        code: 'B2',
        errors: [
          'Esta importación no asigna precios: deja vacía(s) la(s) columna(s) showPrice o usa la importación del tarifario',
        ],
      },
    ]);
    expect(prisma.studyOnPriceSheet.upsert).not.toHaveBeenCalled();
  });

  it('no cambia el slug al actualizar un estudio existente', async () => {
    existingStudies = [{ code: 'A1' }];

    await service.importStudies(branchId, toExcel([row('A1')]));

    const [{ update }] = prisma.study.upsert.mock.calls[0] as [
      { update: Record<string, unknown> },
    ];
    expect(update).not.toHaveProperty('slug');
  });

  it('agrega el código al slug si el nombre ya está tomado en la sucursal o en el archivo', async () => {
    existingSlugs = ['glucosa', 'ph-x1'];

    const result = await service.importStudies(
      branchId,
      toExcel([
        row('CTQP-GL', { name: 'Glucosa' }),
        row('LCR-GL', { name: 'GLUCOSA' }),
        row('CTQP-PH', { name: 'pH' }),
        row('X1', { name: 'pH' }),
      ]),
    );

    expect(result.invalid).toEqual([]);
    const slugs = Object.fromEntries(
      (
        prisma.study.upsert.mock.calls as [
          {
            where: { branchId_code: { code: string } };
            create: { slug: string };
          },
        ][]
      ).map(([{ where, create }]) => [where.branchId_code.code, create.slug]),
    );
    expect(slugs).toEqual({
      'CTQP-GL': 'glucosa-ctqp-gl',
      'LCR-GL': 'glucosa-lcr-gl',
      'CTQP-PH': 'ph',
      X1: 'ph-x1-2',
    });
  });

  it('exige las columnas code, name y serviceName', async () => {
    await expect(
      service.importStudies(branchId, toExcel([{ code: 'A1', name: 'X' }])),
    ).rejects.toThrow(
      new BadRequestException(
        "El archivo debe contener las columnas: 'serviceName'.",
      ),
    );
  });

  it('arma un perfil con parámetros definidos en el mismo archivo', async () => {
    const result = await service.importStudies(
      branchId,
      toExcel([
        row('P1', { isPanel: 'true', parametros: 'c1, C2' }),
        row('C1'),
        row('C2'),
      ]),
    );

    expect(result.invalid).toEqual([]);
    expect(result).toMatchObject({ processed: 3, panelsUpdated: 1 });
    expect(prisma.studyPanelItem.createMany).toHaveBeenCalledWith({
      data: [
        { panelId: 'study-P1', childId: 'study-C1', order: 0 },
        { panelId: 'study-P1', childId: 'study-C2', order: 1 },
      ],
    });
  });

  it('reporta parámetros que no existen en la sucursal', async () => {
    const result = await service.importStudies(
      branchId,
      toExcel([row('P1', { isPanel: 'true', parametros: 'X9' })]),
    );

    expect(result.panelsUpdated).toBe(0);
    expect(result.panelErrors).toEqual([
      { code: 'P1', error: 'Parámetros no encontrados en la sucursal: X9' },
    ]);
  });
});
