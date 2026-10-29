import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { PriceSheetPriceImportService } from './price-sheet-price-import.service';

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

describe('PriceSheetPriceImportService', () => {
  let service: PriceSheetPriceImportService;
  let prisma: {
    study: { findMany: jest.Mock; upsert: jest.Mock };
    studyOnPriceSheet: { findMany: jest.Mock; upsert: jest.Mock };
    $transaction: jest.Mock;
  };
  let studies: Array<{ id: string; code: string; isActive: boolean }>;
  let pricedStudyIds: string[];

  const priceSheet = { id: 'ps-1', branchId: 'branch-1' };

  beforeEach(async () => {
    studies = [
      { id: 'study-A1', code: 'A1', isActive: true },
      { id: 'study-B2', code: 'B2', isActive: true },
      { id: 'study-OFF', code: 'OFF', isActive: false },
    ];
    pricedStudyIds = [];
    prisma = {
      study: {
        findMany: jest.fn(() => Promise.resolve(studies)),
        upsert: jest.fn(),
      },
      studyOnPriceSheet: {
        findMany: jest.fn(() =>
          Promise.resolve(pricedStudyIds.map((studyId) => ({ studyId }))),
        ),
        upsert: jest.fn((args: unknown) => args),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
    };

    const module = await Test.createTestingModule({
      providers: [
        PriceSheetPriceImportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PriceSheetPriceImportService);
  });

  it('la plantilla solo trae code, name y price con una fila de ejemplo', () => {
    const workbook = XLSX.read(service.generateTemplate(), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['Precios']);

    const rows = XLSX.utils.sheet_to_json<Row>(
      workbook.Sheets[workbook.SheetNames[0]],
      { header: 1 },
    );
    expect(rows).toEqual([
      ['code', 'name', 'price'],
      ['BH001', 'Biometría Hemática', 150],
    ]);
  });

  it('crea o actualiza precios sin tocar estudios ni showPrice', async () => {
    pricedStudyIds = ['study-B2'];

    const result = await service.importPrices(
      priceSheet,
      toExcel([
        { code: 'a1', name: 'Ignorado', price: 120.5 },
        { code: 'B2', price: '$1,250.00' },
      ]),
    );

    expect(result).toEqual({
      totalRows: 2,
      created: 1,
      updated: 1,
      skipped: 0,
      invalid: [],
    });
    expect(prisma.study.upsert).not.toHaveBeenCalled();
    expect(prisma.studyOnPriceSheet.upsert).toHaveBeenCalledWith({
      where: {
        studyId_priceSheetId: { studyId: 'study-A1', priceSheetId: 'ps-1' },
      },
      update: { price: new Prisma.Decimal(120.5) },
      create: {
        studyId: 'study-A1',
        priceSheetId: 'ps-1',
        price: new Prisma.Decimal(120.5),
      },
    });
    expect(prisma.studyOnPriceSheet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { price: new Prisma.Decimal(1250) },
      }),
    );
  });

  it('omite filas con precio vacío', async () => {
    const result = await service.importPrices(
      priceSheet,
      toExcel([
        { code: 'A1', price: '' },
        { code: 'B2', price: 90 },
      ]),
    );

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(1);
    expect(prisma.studyOnPriceSheet.upsert).toHaveBeenCalledTimes(1);
  });

  it('rechaza códigos inexistentes, inactivos, duplicados y precios inválidos', async () => {
    const result = await service.importPrices(
      priceSheet,
      toExcel([
        { code: 'ZZ9', price: 10 },
        { code: 'OFF', price: 10 },
        { code: 'A1', price: 10 },
        { code: 'A1', price: 20 },
        { code: 'B2', price: 'abc' },
        { code: '', price: 30 },
      ]),
    );

    expect(result.created).toBe(1);
    expect(result.invalid).toEqual([
      {
        row: 2,
        code: 'ZZ9',
        errors: ["El estudio 'ZZ9' no existe en esta sucursal"],
      },
      { row: 3, code: 'OFF', errors: ["El estudio 'OFF' está inactivo"] },
      {
        row: 5,
        code: 'A1',
        errors: ["El código 'A1' está duplicado en el archivo"],
      },
      {
        row: 6,
        code: 'B2',
        errors: ["El precio 'abc' no es un número válido"],
      },
      { row: 7, code: undefined, errors: ['Falta el código del estudio'] },
    ]);
  });

  it('rechaza precios negativos o con más de 2 decimales', async () => {
    const result = await service.importPrices(
      priceSheet,
      toExcel([
        { code: 'A1', price: '-5' },
        { code: 'B2', price: '10.555' },
      ]),
    );

    expect(result.invalid).toEqual([
      { row: 2, code: 'A1', errors: ['El precio no puede ser negativo'] },
      { row: 3, code: 'B2', errors: ['El precio admite máximo 2 decimales'] },
    ]);
    expect(prisma.studyOnPriceSheet.upsert).not.toHaveBeenCalled();
  });

  it('exige las columnas code y price', async () => {
    await expect(
      service.importPrices(priceSheet, toExcel([{ code: 'A1', name: 'X' }])),
    ).rejects.toThrow(
      new BadRequestException(
        "El archivo debe contener las columnas: 'price'.",
      ),
    );
  });
});
