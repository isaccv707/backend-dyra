import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { StudyCatalogImportService } from './study-catalog-import.service';

type Row = Record<string, string | number>;

const toExcel = (sheets: Record<string, Row[]>): Buffer => {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rows),
      name,
    );
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const catalogDelegate = (existing: string[] = []) => ({
  findMany: jest
    .fn()
    .mockResolvedValue(existing.map((name, i) => ({ id: i + 1, name }))),
  createMany: jest.fn(({ data }: { data: unknown[] }) =>
    Promise.resolve({ count: data.length }),
  ),
});

describe('StudyCatalogImportService', () => {
  let service: StudyCatalogImportService;
  let prisma: {
    studySection: ReturnType<typeof catalogDelegate>;
    sampleType: ReturnType<typeof catalogDelegate>;
    studyTechnique: ReturnType<typeof catalogDelegate>;
  };

  const branchId = 'branch-1';

  beforeEach(async () => {
    prisma = {
      studySection: catalogDelegate(['Hematología']),
      sampleType: catalogDelegate(),
      studyTechnique: catalogDelegate(),
    };

    const module = await Test.createTestingModule({
      providers: [
        StudyCatalogImportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(StudyCatalogImportService);
  });

  it('la plantilla trae una hoja por catálogo con name e isActive', () => {
    const workbook = XLSX.read(service.generateTemplate(), { type: 'buffer' });

    expect(workbook.SheetNames).toEqual([
      'Secciones',
      'Tipos de muestra',
      'Técnicas',
    ]);
    const [header] = XLSX.utils.sheet_to_json<string[]>(
      workbook.Sheets['Secciones'],
      { header: 1 },
    );
    expect(header).toEqual(['name', 'isActive']);
  });

  it('importa la plantilla generada', async () => {
    const result = await service.importCatalogs(
      branchId,
      service.generateTemplate(),
    );

    expect(result.section).toMatchObject({
      created: 0,
      skipped: [{ row: 2, name: 'Hematología' }],
    });
    expect(result.sampleType.created).toBe(1);
    expect(result.technique.created).toBe(1);
  });

  it('crea los nuevos, omite los existentes y reporta filas inválidas', async () => {
    const result = await service.importCatalogs(
      branchId,
      toExcel({
        secciones: [
          { name: '  Química   clínica ' },
          { name: 'HEMATOLOGÍA' },
          { name: 'química clínica' },
          { name: 'Inmunología', isActive: 'no' },
          { name: '', isActive: 'si' },
          { name: 'Orina', isActive: 'quizá' },
        ],
      }),
    );

    expect(result.section).toEqual({
      found: true,
      totalRows: 6,
      created: 2,
      skipped: [{ row: 3, name: 'HEMATOLOGÍA' }],
      invalid: [
        {
          row: 4,
          name: 'química clínica',
          errors: ['"química clínica" está repetido en la hoja (fila 2)'],
        },
        { row: 6, errors: ['name es obligatorio'] },
        {
          row: 7,
          name: 'Orina',
          errors: ['isActive debe ser true/false, 1/0 o si/no'],
        },
      ],
    });
    expect(prisma.studySection.createMany).toHaveBeenCalledWith({
      data: [
        { name: 'Química clínica', branchId, isActive: true },
        { name: 'Inmunología', branchId, isActive: false },
      ],
      skipDuplicates: true,
    });
    expect(result.sampleType.found).toBe(false);
    expect(prisma.sampleType.createMany).not.toHaveBeenCalled();
  });

  it('reconoce las hojas sin importar acentos/mayúsculas y reporta las ignoradas', async () => {
    const result = await service.importCatalogs(
      branchId,
      toExcel({
        TECNICAS: [{ name: 'ELISA' }],
        'Tipo de muestra': [{ name: 'Suero' }],
        Notas: [{ name: 'x' }],
      }),
    );

    expect(result.technique.created).toBe(1);
    expect(result.sampleType.created).toBe(1);
    expect(result.ignoredSheets).toEqual(['Notas']);
  });

  it('rechaza un archivo sin hojas reconocidas', async () => {
    await expect(
      service.importCatalogs(branchId, toExcel({ Hoja1: [{ name: 'x' }] })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza una hoja sin columna name', async () => {
    await expect(
      service.importCatalogs(
        branchId,
        toExcel({ Secciones: [{ nombre: 'x' }] }),
      ),
    ).rejects.toThrow(
      new BadRequestException(
        "La hoja 'Secciones' debe contener la columna 'name'.",
      ),
    );
  });
});
