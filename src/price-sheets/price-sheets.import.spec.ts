import { Test } from '@nestjs/testing';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { PriceSheetsService } from './price-sheets.service';

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

describe('PriceSheetsService.importStudiesFromExcel: catálogos obligatorios', () => {
  let service: PriceSheetsService;
  let prisma: {
    priceSheets: { findUnique: jest.Mock };
    service: { findMany: jest.Mock };
    study: { findMany: jest.Mock; upsert: jest.Mock };
    studyOnPriceSheet: { upsert: jest.Mock };
    studySection: ReturnType<typeof catalogDelegate>;
    sampleType: ReturnType<typeof catalogDelegate>;
    studyTechnique: ReturnType<typeof catalogDelegate>;
  };
  let existingStudies: Array<{
    code: string;
    isPanel?: boolean;
    isActive?: boolean;
    _count?: { referenceValues: number; parentPanels?: number };
  }>;

  const branchId = 'branch-1';
  const user = { branches: [] };

  const row = (code: string, overrides: Row = {}): Row => ({
    code,
    name: `Estudio ${code}`,
    serviceName: 'Química',
    price: 100,
    section: 'Química clínica',
    sampleType: 'Suero',
    technique: 'Colorimetría',
    ...overrides,
  });

  beforeEach(async () => {
    existingStudies = [];
    prisma = {
      priceSheets: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ps-1', branchId }),
      },
      service: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'svc-1', name: 'Química' }]),
      },
      study: {
        findMany: jest.fn(({ where }: { where: { panelItems?: unknown } }) =>
          Promise.resolve(where.panelItems ? [] : existingStudies),
        ),
        upsert: jest.fn(({ create }: { create: { code: string } }) =>
          Promise.resolve({ id: `study-${create.code}` }),
        ),
      },
      studyOnPriceSheet: { upsert: jest.fn() },
      studySection: catalogDelegate(),
      sampleType: catalogDelegate(),
      studyTechnique: catalogDelegate(),
    };

    const module = await Test.createTestingModule({
      providers: [
        PriceSheetsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PriceSheetsService);
  });

  it('rechaza una fila que crearía un estudio sin sección, tipo de muestra o técnica', async () => {
    const result = await service.importStudiesFromExcel(
      'ps-1',
      toExcel([
        row('A1'),
        row('B2', { section: '', technique: '' }),
        row('C3', { sampleType: '' }),
      ]),
      user,
    );

    expect(result.processed).toBe(1);
    expect(result.invalid).toEqual([
      {
        row: 3,
        code: 'B2',
        errors: [
          'Para crear un estudio nuevo son obligatorias las columnas: section, technique',
        ],
      },
      {
        row: 4,
        code: 'C3',
        errors: [
          'Para crear un estudio nuevo son obligatorias las columnas: sampleType',
        ],
      },
    ]);
    expect(prisma.study.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.study.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          code: 'A1',
          section: { connect: { id: 1 } },
          sampleType: { connect: { id: 1 } },
          technique: { connect: { id: 1 } },
        }),
      }),
    );
  });

  it('rechaza un perfil con units o decimals', async () => {
    const result = await service.importStudiesFromExcel(
      'ps-1',
      toExcel([
        row('P1', { isPanel: 'true', units: 'mg/dL' }),
        row('P2', { isPanel: 'true', decimals: 2 }),
        row('A1', { units: 'mg/dL', decimals: 1 }),
      ]),
      user,
    );

    expect(result.processed).toBe(1);
    expect(result.invalid).toEqual([
      {
        row: 2,
        code: 'P1',
        errors: ['Un perfil (isPanel = true) no puede tener units'],
      },
      {
        row: 3,
        code: 'P2',
        errors: ['Un perfil (isPanel = true) no puede tener decimals'],
      },
    ]);
    expect(prisma.study.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          code: 'A1',
          units: 'mg/dL',
          decimals: 1,
        }),
      }),
    );
  });

  it('no convierte en perfil un estudio existente con valores de referencia', async () => {
    existingStudies = [
      { code: 'A1', isPanel: false, _count: { referenceValues: 1 } },
    ];

    const result = await service.importStudiesFromExcel(
      'ps-1',
      toExcel([row('A1', { isPanel: 'true' })]),
      user,
    );

    expect(result.processed).toBe(0);
    expect(result.invalid).toEqual([
      {
        row: 2,
        code: 'A1',
        errors: [
          'No se puede marcar como perfil: el estudio tiene valores de referencia',
        ],
      },
    ]);
  });

  it('no desactiva un estudio existente que forma parte de un perfil', async () => {
    existingStudies = [
      {
        code: 'A1',
        isPanel: false,
        isActive: true,
        _count: { referenceValues: 0, parentPanels: 1 },
      },
    ];

    const result = await service.importStudiesFromExcel(
      'ps-1',
      toExcel([row('A1', { isActive: 'false' })]),
      user,
    );

    expect(result.processed).toBe(0);
    expect(result.invalid).toEqual([
      {
        row: 2,
        code: 'A1',
        errors: [
          'No se puede desactivar: el estudio forma parte de uno o más perfiles',
        ],
      },
    ]);
  });

  it('una fila con precio vacío guarda el estudio sin asignarle precio', async () => {
    const result = await service.importStudiesFromExcel(
      'ps-1',
      toExcel([row('A1', { price: '' }), row('B2')]),
      user,
    );

    expect(result.invalid).toEqual([]);
    expect(result.processed).toBe(2);
    expect(prisma.study.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.studyOnPriceSheet.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.studyOnPriceSheet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ studyId: 'study-B2' }),
      }),
    );
  });

  it('permite columnas vacías al actualizar un estudio existente y conserva sus catálogos', async () => {
    existingStudies = [{ code: 'B2' }];

    const result = await service.importStudiesFromExcel(
      'ps-1',
      toExcel([
        row('B2', { section: '', sampleType: '', technique: '', price: 150 }),
      ]),
      user,
    );

    expect(result.invalid).toEqual([]);
    expect(result.processed).toBe(1);
    expect(prisma.study.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          section: undefined,
          sampleType: undefined,
          technique: undefined,
        }),
      }),
    );
  });
});
