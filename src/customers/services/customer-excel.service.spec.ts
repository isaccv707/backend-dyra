import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CustomersService } from '../customers.service';
import {
  CUSTOMER_EXCEL_COLUMNS,
  CustomerExcelService,
} from './customer-excel.service';

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const SHEET_ID = '33333333-3333-4333-8333-333333333333';
const OLD_SHEET_ID = '44444444-4444-4444-8444-444444444444';
const EXISTING_ID = '22222222-2222-4222-8222-222222222222';
const user = { branches: [{ id: BRANCH_ID }] };

const priceSheets = [
  { id: SHEET_ID, name: 'Convenios', isActive: true },
  { id: OLD_SHEET_ID, name: 'Tarifa 2024', isActive: false },
];

type Row = (string | number | null)[];

const workbookBuffer = (
  rows: Row[],
  headers: string[] = [...CUSTOMER_EXCEL_COLUMNS],
) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    'Clientes',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const readSheet = (buffer: Buffer, index: number) => {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return {
    name: workbook.SheetNames[index],
    rows: XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[workbook.SheetNames[index]],
      { header: 1 },
    ),
  };
};

describe('CustomerExcelService', () => {
  let service: CustomerExcelService;
  let prisma: {
    branch: { findUnique: jest.Mock };
    priceSheets: { findMany: jest.Mock };
    customer: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let customers: Record<
    'prepareCreate' | 'prepareUpdate' | 'create' | 'update',
    jest.Mock
  >;
  const tx = { tx: true };

  beforeEach(async () => {
    prisma = {
      branch: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: BRANCH_ID, name: 'Sucursal Centro' }),
      },
      priceSheets: { findMany: jest.fn().mockResolvedValue(priceSheets) },
      customer: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: EXISTING_ID, name: 'Clínica Sur' }]),
      },
      $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    customers = {
      prepareCreate: jest.fn().mockResolvedValue({}),
      prepareUpdate: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    };

    const module = await Test.createTestingModule({
      providers: [
        CustomerExcelService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomersService, useValue: customers },
      ],
    }).compile();
    service = module.get(CustomerExcelService);
  });

  describe('generateTemplate', () => {
    it('trae la hoja de clientes y la de tarifarios de la sucursal', async () => {
      const { buffer, branchName } = await service.generateTemplate(
        BRANCH_ID,
        user,
      );

      expect(branchName).toBe('Sucursal Centro');
      const customersSheet = readSheet(buffer, 0);
      expect(customersSheet.name).toBe('Clientes');
      expect(customersSheet.rows[0]).toEqual([...CUSTOMER_EXCEL_COLUMNS]);
      // The example uses an active sheet of the branch.
      expect(customersSheet.rows[1]).toContain('Convenios');

      const sheets = readSheet(buffer, 1);
      expect(sheets.name).toBe('Tarifarios (referencia)');
      expect(sheets.rows).toEqual([
        ['name', 'id', 'estado'],
        ['Convenios', SHEET_ID, 'Activa'],
        ['Tarifa 2024', OLD_SHEET_ID, 'Inactiva (no se puede asignar)'],
      ]);
    });

    it('rechaza una sucursal ajena', async () => {
      await expect(
        service.generateTemplate(BRANCH_ID, { branches: [{ id: 'otra' }] }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('exportByBranch', () => {
    it('exporta con las columnas de la plantilla', async () => {
      prisma.customer.findMany.mockResolvedValue([
        {
          name: 'Clínica Sur',
          email: 'pagos@sur.mx',
          accountsReceivable: true,
          liquidate: false,
          isActive: true,
          priceSheet: { id: SHEET_ID, name: 'Convenios', isActive: true },
          contractAmount: new Prisma.Decimal('1500.5'),
          patientAmount: null,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: null,
        },
      ]);

      const { buffer } = await service.exportByBranch(BRANCH_ID, user);

      expect(readSheet(buffer, 0).rows).toEqual([
        [...CUSTOMER_EXCEL_COLUMNS],
        [
          'Clínica Sur',
          'pagos@sur.mx',
          'Sí',
          'No',
          'Convenios',
          1500.5,
          '',
          '2026-01-01',
          '',
          'Sí',
        ],
      ]);
      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { branchId: BRANCH_ID } }),
      );
    });
  });

  describe('importFromExcel', () => {
    it('crea los nuevos y actualiza los existentes por nombre (sin distinguir mayúsculas)', async () => {
      const buffer = workbookBuffer([
        [
          'Empresa Nueva',
          'A@Nueva.mx',
          'Sí',
          '',
          'convenios',
          '$1,200.50',
          300,
          '2026-01-01',
          '31/12/2026',
          '',
        ],
        ['CLÍNICA SUR', 'sur@x.mx', '', 'sí', '', '', '', '', '', 'No'],
      ]);

      const result = await service.importFromExcel(BRANCH_ID, buffer, user);

      expect(result).toEqual({
        totalRows: 2,
        created: 1,
        updated: 1,
        invalid: [],
      });
      expect(customers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Empresa Nueva',
          email: 'a@nueva.mx',
          accountsReceivable: true,
          priceSheetId: SHEET_ID,
          contractAmount: 1200.5,
          patientAmount: 300,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          branchId: BRANCH_ID,
        }),
        user,
        tx,
      );
      // Only accountsReceivable was filled: the service infers liquidate.
      expect(
        (customers.create.mock.calls[0][0] as { liquidate?: boolean })
          .liquidate,
      ).toBeUndefined();
      expect(customers.update).toHaveBeenCalledWith(
        EXISTING_ID,
        expect.objectContaining({
          liquidate: true,
          isActive: false,
          priceSheetId: null,
          contractAmount: null,
          startDate: null,
        }),
        user,
        tx,
      );
    });

    it('lee fechas de Excel (número de serie)', async () => {
      // 46023 = 2026-01-01
      const buffer = workbookBuffer([
        ['Fecha Serial', 'f@x.mx', '', '', '', '', '', 46023, '', ''],
      ]);

      await service.importFromExcel(BRANCH_ID, buffer, user);

      expect(customers.create).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: '2026-01-01', endDate: null }),
        user,
        tx,
      );
    });

    it('reporta las filas inválidas y guarda las válidas', async () => {
      customers.prepareCreate.mockImplementation((dto: { name: string }) =>
        dto.name === 'Ambas'
          ? Promise.reject(
              new BadRequestException('elige solo una modalidad de pago'),
            )
          : Promise.resolve({}),
      );
      const buffer = workbookBuffer([
        ['Buena', 'b@x.mx', '', '', '', '', '', '', '', ''],
        ['Mal Correo', 'no-es-correo', '', '', '', '', '', '', '', ''],
        ['Ambas', 'a@x.mx', 'Sí', 'Sí', '', '', '', '', '', ''],
        ['Tarifario', 't@x.mx', '', '', 'No existe', '', '', '', '', ''],
        [
          'Formato',
          'f@x.mx',
          'quizá',
          '',
          '',
          'mucho',
          '',
          '2026-31-31x',
          '',
          '',
        ],
        ['buena', 'dup@x.mx', '', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', '', '', ''],
        ['', 'sin-nombre@x.mx', '', '', '', '', '', '', '', ''],
      ]);

      const result = await service.importFromExcel(BRANCH_ID, buffer, user);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      const byRow = Object.fromEntries(
        result.invalid.map((item) => [item.row, item.errors.join(' | ')]),
      );
      expect(Object.keys(byRow).map(Number)).toEqual([3, 4, 5, 6, 7, 9]);
      expect(byRow[3]).toContain('correo');
      expect(byRow[4]).toContain('elige solo una modalidad de pago');
      expect(byRow[5]).toContain("priceSheet: 'No existe' no existe");
      expect(byRow[6]).toContain('accountsReceivable');
      expect(byRow[6]).toContain('contractAmount');
      expect(byRow[6]).toContain('startDate');
      expect(byRow[7]).toContain('ya aparece en la fila 2');
      expect(byRow[9]).toContain('name');
      expect(customers.create).toHaveBeenCalledTimes(1);
    });

    it('exige la columna name', async () => {
      const buffer = workbookBuffer([['x']], ['nombre']);
      await expect(
        service.importFromExcel(BRANCH_ID, buffer, user),
      ).rejects.toThrow("'name'");
    });

    it('acepta clientes sin correo', async () => {
      const buffer = workbookBuffer([
        ['Sin Correo', '', '', '', '', '', '', '', '', ''],
      ]);

      const result = await service.importFromExcel(BRANCH_ID, buffer, user);

      expect(result.created).toBe(1);
      expect(result.invalid).toEqual([]);
      expect(customers.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sin Correo', email: null }),
        user,
        tx,
      );
    });

    it('rechaza un archivo sin filas', async () => {
      await expect(
        service.importFromExcel(BRANCH_ID, workbookBuffer([]), user),
      ).rejects.toThrow('no contiene filas');
    });
  });
});
