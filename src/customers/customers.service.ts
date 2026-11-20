import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import {
  assertBranchAccess,
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { FindCustomersDto } from './dto/find-customers.dto';
import {
  assertValidPeriod,
  CUSTOMER_INCLUDE,
  CustomerWithPriceSheet,
  resolvePaymentMode,
  toCustomerResponse,
  toDateOnly,
} from './utils/customer.util';

/** Prisma client or an open transaction (ticket forms apply inside one). */
export type CustomerDb = Prisma.TransactionClient;

const CUSTOMER_ALLOWED_FIELDS = [
  'name',
  'email',
  'isActive',
  'accountsReceivable',
  'liquidate',
  'contractAmount',
  'patientAmount',
  'startDate',
  'endDate',
  'createdAt',
];

const ENTITY_NAME = 'Cliente';

const DB_MESSAGES = {
  notFound: 'Cliente no encontrado',
  conflict: () => 'Ya existe un cliente con ese nombre en esta sucursal',
  foreignKey: 'La hoja de precios o la sucursal no existe',
};

/**
 * Clientes (empresas/convenios) por sucursal, con hoja de precios opcional de
 * la misma sucursal. Modalidad de pago excluyente: cuenta por cobrar o
 * liquida al instante (también lo garantiza un CHECK en la base).
 *
 * `prepareCreate`/`prepareUpdate` validan sin escribir: los usan también los
 * formularios de tickets CogniTI (CLIENT_CREATE / CLIENT_UPDATE).
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertNameAvailable(
    db: CustomerDb,
    branchId: string,
    name: string,
    excludeId?: string,
  ) {
    const duplicate = await db.customer.findFirst({
      where: {
        branchId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId && { NOT: { id: excludeId } }),
      },
      select: { name: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `Ya existe el cliente "${duplicate.name}" en esta sucursal`,
      );
    }
  }

  private async assertPriceSheetUsable(
    db: CustomerDb,
    priceSheetId: string,
    branchId: string,
  ) {
    const sheet = await db.priceSheets.findUnique({
      where: { id: priceSheetId },
      select: { branchId: true, isActive: true },
    });
    if (!sheet) {
      throw new NotFoundException(
        `Hoja de precios con el ID ${priceSheetId} no encontrada`,
      );
    }
    if (sheet.branchId !== branchId) {
      throw new BadRequestException(
        'La hoja de precios debe pertenecer a la misma sucursal del cliente',
      );
    }
    if (!sheet.isActive) {
      throw new BadRequestException(
        'No se puede asociar una hoja de precios inactiva',
      );
    }
  }

  /** Validates a creation and returns the row to insert (nothing is written). */
  async prepareCreate(
    dto: CreateCustomerDto,
    user: BranchScopedUser,
    db: CustomerDb = this.prisma,
  ): Promise<Prisma.CustomerUncheckedCreateInput> {
    assertBranchAccess(user, dto.branchId);

    const branch = await db.branch.findUnique({
      where: { id: dto.branchId },
      select: { id: true },
    });
    if (!branch) {
      throw new NotFoundException(
        `Sucursal con el ID ${dto.branchId} no encontrada`,
      );
    }

    const paymentMode = resolvePaymentMode(dto);
    const startDate = toDateOnly(dto.startDate) ?? null;
    const endDate = toDateOnly(dto.endDate) ?? null;
    assertValidPeriod(startDate, endDate);

    await this.assertNameAvailable(db, dto.branchId, dto.name);
    if (dto.priceSheetId) {
      await this.assertPriceSheetUsable(db, dto.priceSheetId, dto.branchId);
    }

    return {
      name: dto.name,
      email: dto.email,
      ...paymentMode,
      isActive: dto.isActive ?? true,
      priceSheetId: dto.priceSheetId ?? null,
      contractAmount: dto.contractAmount ?? null,
      patientAmount: dto.patientAmount ?? null,
      startDate,
      endDate,
      branchId: dto.branchId,
    };
  }

  async create(
    dto: CreateCustomerDto,
    user: BranchScopedUser,
    db: CustomerDb = this.prisma,
  ) {
    const data = await this.prepareCreate(dto, user, db);
    try {
      const customer = await db.customer.create({
        data,
        include: CUSTOMER_INCLUDE,
      });
      return toCustomerResponse(customer);
    } catch (error) {
      handleDatabaseErrors(error, ENTITY_NAME, DB_MESSAGES);
    }
  }

  async findAll(dto: FindCustomersDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'email'],
      defaultSort: { name: 'asc' },
      allowedFields: CUSTOMER_ALLOWED_FIELDS,
    });

    const finalWhere: Prisma.CustomerWhereInput = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.accountsReceivable !== undefined && {
        accountsReceivable: dto.accountsReceivable,
      }),
      ...(dto.priceSheetId && { priceSheetId: dto.priceSheetId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: CUSTOMER_INCLUDE,
      }),
      this.prisma.customer.count({ where: finalWhere }),
    ]);

    return paginatedResponse(
      data.map(toCustomerResponse),
      total,
      dto.page ?? 1,
      dto.limit ?? 10,
    );
  }

  /** Raw row (with its price sheet), after checking the user's branches. */
  async findAccessible(
    id: string,
    user: BranchScopedUser,
    db: CustomerDb = this.prisma,
  ): Promise<CustomerWithPriceSheet> {
    const customer = await db.customer.findUnique({
      where: { id },
      include: CUSTOMER_INCLUDE,
    });
    if (!customer) {
      throw new NotFoundException(`Cliente con el ID ${id} no encontrado`);
    }
    assertBranchAccess(user, customer.branchId);
    return customer;
  }

  async findOne(id: string, user: BranchScopedUser) {
    return toCustomerResponse(await this.findAccessible(id, user));
  }

  /** Validates an update and returns the current row plus the data to write. */
  async prepareUpdate(
    id: string,
    dto: UpdateCustomerDto,
    user: BranchScopedUser,
    db: CustomerDb = this.prisma,
  ) {
    const current = await this.findAccessible(id, user, db);

    const paymentMode = resolvePaymentMode(dto, current);
    const startDate = toDateOnly(dto.startDate);
    const endDate = toDateOnly(dto.endDate);
    assertValidPeriod(
      startDate === undefined ? current.startDate : startDate,
      endDate === undefined ? current.endDate : endDate,
    );

    if (dto.name !== undefined) {
      await this.assertNameAvailable(db, current.branchId, dto.name, id);
    }
    if (dto.priceSheetId && dto.priceSheetId !== current.priceSheetId) {
      await this.assertPriceSheetUsable(db, dto.priceSheetId, current.branchId);
    }

    const data: Prisma.CustomerUncheckedUpdateInput = {
      name: dto.name,
      email: dto.email,
      ...paymentMode,
      isActive: dto.isActive,
      priceSheetId: dto.priceSheetId,
      contractAmount: dto.contractAmount,
      patientAmount: dto.patientAmount,
      startDate,
      endDate,
    };
    return { current, data };
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
    user: BranchScopedUser,
    db: CustomerDb = this.prisma,
  ) {
    const { data } = await this.prepareUpdate(id, dto, user, db);
    try {
      const customer = await db.customer.update({
        where: { id },
        data,
        include: CUSTOMER_INCLUDE,
      });
      return toCustomerResponse(customer);
    } catch (error) {
      handleDatabaseErrors(error, ENTITY_NAME, DB_MESSAGES);
    }
  }

  async remove(id: string, user: BranchScopedUser) {
    const customer = await this.findAccessible(id, user);

    try {
      await this.prisma.customer.delete({ where: { id } });
      return toCustomerResponse(customer);
    } catch (error) {
      handleDatabaseErrors(error, ENTITY_NAME, DB_MESSAGES);
    }
  }
}
