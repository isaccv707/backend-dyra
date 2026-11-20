import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  assertBranchAccess,
  BranchScopedUser,
} from 'src/common/utils/branch-access.util';
import { validateFormPayload } from 'src/tickets/forms/validate-form-payload.util';
import { CustomersService } from '../customers.service';
import { CreateCustomerDto } from '../dto/create-customer.dto';
import {
  CUSTOMER_INCLUDE,
  formatDateOnly,
  PaymentMode,
  resolvePaymentMode,
} from '../utils/customer.util';

/**
 * Columns shared by the template, the export and the import, so an exported
 * file can be edited and imported back.
 */
export const CUSTOMER_EXCEL_COLUMNS = [
  'name',
  'email',
  'accountsReceivable',
  'liquidate',
  'priceSheet',
  'contractAmount',
  'patientAmount',
  'startDate',
  'endDate',
  'isActive',
] as const;
type CustomerColumn = (typeof CUSTOMER_EXCEL_COLUMNS)[number];

const REQUIRED_COLUMNS: CustomerColumn[] = ['name', 'email'];
export const CUSTOMER_IMPORT_MAX_ROWS = 2000;
const IMPORT_TX_TIMEOUT_MS = 60_000;

const CUSTOMERS_SHEET = 'Clientes';
const PRICE_SHEETS_SHEET = 'Tarifarios (referencia)';

type Cell = string | number | boolean | Date | null | undefined;
type RawRow = Partial<Record<string, Cell>>;

export interface CustomerImportRowError {
  row: number;
  name?: string;
  errors: string[];
}

export interface CustomerImportResult {
  totalRows: number;
  created: number;
  updated: number;
  invalid: CustomerImportRowError[];
}

const yesNo = (value: boolean) => (value ? 'Sí' : 'No');

const text = (value: Cell) =>
  value === null || value === undefined ? '' : String(value).trim();

const TRUE_VALUES = ['true', '1', 'si', 'sí', 'yes', 'x'];
const FALSE_VALUES = ['false', '0', 'no'];

/** '' → undefined; otherwise a boolean or an error message. */
function parseBool(value: Cell, column: string): boolean | undefined | string {
  if (typeof value === 'boolean') return value;
  const raw = text(value).toLowerCase();
  if (!raw) return undefined;
  if (TRUE_VALUES.includes(raw)) return true;
  if (FALSE_VALUES.includes(raw)) return false;
  return `${column}: '${text(value)}' no es Sí/No (true/false)`;
}

/** '' → null (clears the amount); otherwise a number or an error message. */
function parseAmount(value: Cell, column: string): number | null | string {
  if (typeof value === 'number') return value;
  const raw = text(value);
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return `${column}: '${raw}' no es un monto válido`;
  }
  return Number(cleaned);
}

const pad = (n: number) => String(n).padStart(2, '0');
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/**
 * '' → null. Accepts an Excel date (serial number), YYYY-MM-DD and
 * DD/MM/YYYY; returns 'YYYY-MM-DD' or an error message.
 */
function parseDate(
  value: Cell,
  column: string,
): string | null | { error: string } {
  if (typeof value === 'number') {
    // Excel date serial: days since 1899-12-30 (1900 date system).
    if (!Number.isFinite(value) || value < 1 || value > 2_958_465) {
      return { error: `${column}: fecha inválida` };
    }
    return new Date(EXCEL_EPOCH_MS + Math.floor(value) * DAY_MS)
      .toISOString()
      .slice(0, 10);
  }
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (dmy) return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  return {
    error: `${column}: '${raw}' no es una fecha válida (AAAA-MM-DD o DD/MM/AAAA)`,
  };
}

const errorMessages = (error: unknown): string[] => {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const message =
      typeof response === 'object' && response !== null && 'message' in response
        ? (response as { message: unknown }).message
        : error.message;
    return Array.isArray(message) ? message.map(String) : [String(message)];
  }
  throw error;
};

type PriceSheetRef = { id: string; name: string; isActive: boolean };

/**
 * Bulk Excel for customers of one branch: template (with the branch's price
 * sheets on a second sheet), export and import. The import upserts by name
 * (case-insensitive) with the same rules as the CRUD; invalid rows are
 * reported and the valid ones are saved together.
 */
@Injectable()
export class CustomerExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
  ) {}

  private async loadBranch(branchId: string, user: BranchScopedUser) {
    assertBranchAccess(user, branchId);
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, name: true },
    });
    if (!branch) {
      throw new NotFoundException(
        `Sucursal con el ID ${branchId} no encontrada`,
      );
    }
    return branch;
  }

  private loadPriceSheets(branchId: string): Promise<PriceSheetRef[]> {
    return this.prisma.priceSheets.findMany({
      where: { branchId },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  private priceSheetsSheet(priceSheets: PriceSheetRef[]) {
    return XLSX.utils.aoa_to_sheet([
      ['name', 'id', 'estado'],
      ...priceSheets.map((sheet) => [
        sheet.name,
        sheet.id,
        sheet.isActive ? 'Activa' : 'Inactiva (no se puede asignar)',
      ]),
    ]);
  }

  private customersSheet(rows: (string | number)[][]) {
    const sheet = XLSX.utils.aoa_to_sheet([
      [...CUSTOMER_EXCEL_COLUMNS],
      ...rows,
    ]);
    sheet['!cols'] = CUSTOMER_EXCEL_COLUMNS.map((column) => ({
      wch:
        column === 'name' || column === 'email' || column === 'priceSheet'
          ? 30
          : 16,
    }));
    return sheet;
  }

  private toBuffer(workbook: XLSX.WorkBook) {
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  async generateTemplate(branchId: string, user: BranchScopedUser) {
    const branch = await this.loadBranch(branchId, user);
    const priceSheets = await this.loadPriceSheets(branchId);
    const example = priceSheets.find((sheet) => sheet.isActive);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      this.customersSheet([
        [
          'Clínica del Sur',
          'facturacion@clinicasur.mx',
          'Sí',
          'No',
          example?.name ?? '',
          15000,
          250,
          '2026-01-01',
          '2026-12-31',
          'Sí',
        ],
      ]),
      CUSTOMERS_SHEET,
    );
    XLSX.utils.book_append_sheet(
      workbook,
      this.priceSheetsSheet(priceSheets),
      PRICE_SHEETS_SHEET,
    );
    return { buffer: this.toBuffer(workbook), branchName: branch.name };
  }

  async exportByBranch(branchId: string, user: BranchScopedUser) {
    const branch = await this.loadBranch(branchId, user);
    const [customers, priceSheets] = await Promise.all([
      this.prisma.customer.findMany({
        where: { branchId },
        include: CUSTOMER_INCLUDE,
        orderBy: { name: 'asc' },
      }),
      this.loadPriceSheets(branchId),
    ]);

    const amount = (value: Prisma.Decimal | null) =>
      value === null ? '' : Number(value);
    const rows = customers.map((customer) => [
      customer.name,
      customer.email,
      yesNo(customer.accountsReceivable),
      yesNo(customer.liquidate),
      customer.priceSheet?.name ?? '',
      amount(customer.contractAmount),
      amount(customer.patientAmount),
      formatDateOnly(customer.startDate) ?? '',
      formatDateOnly(customer.endDate) ?? '',
      yesNo(customer.isActive),
    ]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      this.customersSheet(rows),
      CUSTOMERS_SHEET,
    );
    XLSX.utils.book_append_sheet(
      workbook,
      this.priceSheetsSheet(priceSheets),
      PRICE_SHEETS_SHEET,
    );
    return { buffer: this.toBuffer(workbook), branchName: branch.name };
  }

  private readRows(buffer: Buffer): RawRow[] {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException('No se pudo leer el archivo de Excel');
    }
    const sheetName = workbook.SheetNames.includes(CUSTOMERS_SHEET)
      ? CUSTOMERS_SHEET
      : workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException('El archivo de Excel no contiene hojas.');
    }

    // raw: numbers stay numbers (amounts, Excel date serials).
    const rows = XLSX.utils.sheet_to_json<RawRow>(workbook.Sheets[sheetName], {
      defval: null,
      raw: true,
      blankrows: false,
    });
    if (!rows.length) {
      throw new BadRequestException('El Excel no contiene filas de datos');
    }
    if (rows.length > CUSTOMER_IMPORT_MAX_ROWS) {
      throw new BadRequestException(
        `El archivo tiene ${rows.length} filas; el máximo por importación es ${CUSTOMER_IMPORT_MAX_ROWS}`,
      );
    }

    const headers = new Set(rows.flatMap((row) => Object.keys(row)));
    const missing = REQUIRED_COLUMNS.filter((column) => !headers.has(column));
    if (missing.length) {
      throw new BadRequestException(
        `El archivo debe contener las columnas: ${missing.map((c) => `'${c}'`).join(', ')}. Descarga la plantilla para ver el formato.`,
      );
    }
    return rows;
  }

  /** Cells → CreateCustomerDto-like payload, or the row's format errors. */
  private parseRow(
    raw: RawRow,
    branchId: string,
    priceSheets: PriceSheetRef[],
  ): { payload: Record<string, unknown>; errors: string[] } {
    const errors: string[] = [];
    const payload: Record<string, unknown> = {
      name: text(raw.name),
      email: text(raw.email),
      branchId,
    };

    for (const column of [
      'accountsReceivable',
      'liquidate',
      'isActive',
    ] as const) {
      const value = parseBool(raw[column], column);
      if (typeof value === 'string') errors.push(value);
      else if (value !== undefined) payload[column] = value;
    }

    for (const column of ['contractAmount', 'patientAmount'] as const) {
      const value = parseAmount(raw[column], column);
      if (typeof value === 'string') errors.push(value);
      else payload[column] = value;
    }

    for (const column of ['startDate', 'endDate'] as const) {
      const value = parseDate(raw[column], column);
      if (value !== null && typeof value === 'object') errors.push(value.error);
      else payload[column] = value;
    }

    const sheetRef = text(raw.priceSheet);
    if (!sheetRef) {
      payload.priceSheetId = null;
    } else {
      const lower = sheetRef.toLowerCase();
      const sheet =
        priceSheets.find((s) => s.id === sheetRef) ??
        priceSheets.find((s) => s.name.toLowerCase() === lower);
      if (sheet) payload.priceSheetId = sheet.id;
      else
        errors.push(
          `priceSheet: '${sheetRef}' no existe en esta sucursal (consulta la hoja "${PRICE_SHEETS_SHEET}")`,
        );
    }

    return { payload, errors };
  }

  async importFromExcel(
    branchId: string,
    buffer: Buffer,
    user: BranchScopedUser,
  ): Promise<CustomerImportResult> {
    await this.loadBranch(branchId, user);
    const rows = this.readRows(buffer);
    const [priceSheets, existing] = await Promise.all([
      this.loadPriceSheets(branchId),
      this.prisma.customer.findMany({
        where: { branchId },
        select: { id: true, name: true },
      }),
    ]);
    const existingByName = new Map(
      existing.map((c) => [c.name.toLowerCase(), c.id]),
    );

    const invalid: CustomerImportRowError[] = [];
    const toCreate: CreateCustomerDto[] = [];
    const toUpdate: { id: string; dto: CreateCustomerDto }[] = [];
    const seenNames = new Map<string, number>();

    for (let index = 0; index < rows.length; index++) {
      const row = index + 2; // header is row 1
      const raw = rows[index];
      if (CUSTOMER_EXCEL_COLUMNS.every((column) => !text(raw[column])))
        continue;

      const { payload, errors } = this.parseRow(raw, branchId, priceSheets);
      const name = payload.name as string;
      const nameKey = name.toLowerCase();
      if (name && seenNames.has(nameKey)) {
        errors.push(
          `El cliente '${name}' ya aparece en la fila ${seenNames.get(nameKey)} del archivo`,
        );
      }
      if (name) seenNames.set(nameKey, row);

      // Report every problem of the row at once: cell format, DTO rules and
      // payment mode (the remaining checks need a clean row).
      let dto: CreateCustomerDto | undefined;
      try {
        dto = await validateFormPayload(CreateCustomerDto, payload);
      } catch (error) {
        errors.push(...errorMessages(error));
      }
      try {
        resolvePaymentMode(payload as Partial<PaymentMode>);
      } catch (error) {
        errors.push(...errorMessages(error));
      }
      if (errors.length || !dto) {
        invalid.push({ row, name: name || undefined, errors });
        continue;
      }

      try {
        const existingId = existingByName.get(nameKey);
        if (existingId) {
          // An existing customer keeps its status unless the column says otherwise.
          const { branchId: _branchId, ...changes } = dto;
          await this.customers.prepareUpdate(existingId, changes, user);
          toUpdate.push({ id: existingId, dto });
        } else {
          await this.customers.prepareCreate(dto, user);
          toCreate.push(dto);
        }
      } catch (error) {
        invalid.push({
          row,
          name: name || undefined,
          errors: errorMessages(error),
        });
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const dto of toCreate) await this.customers.create(dto, user, tx);
        for (const { id, dto } of toUpdate) {
          const { branchId: _branchId, ...changes } = dto;
          await this.customers.update(id, changes, user, tx);
        }
      },
      { timeout: IMPORT_TX_TIMEOUT_MS },
    );

    return {
      totalRows: rows.length,
      created: toCreate.length,
      updated: toUpdate.length,
      invalid,
    };
  }
}
