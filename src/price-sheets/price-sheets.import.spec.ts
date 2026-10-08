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
  let existingCodes: string[];

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
    existingCodes = [];
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
          Promise.resolve(
            where.panelItems ? [] : existingCodes.map((code) => ({ code })),
          ),
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

  it('permite columnas vacías al actualizar un estudio existente y conserva sus catálogos', async () => {
    existingCodes = ['B2'];

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
