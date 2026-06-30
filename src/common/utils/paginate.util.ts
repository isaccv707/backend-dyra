import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatedQueryDto, QueryFilterDto, QueryFiltersDto } from '../dto/paginated-query.dto';

export interface PaginatedQueryOptions {
  /** Fields used for the `search` full-text OR. */
  searchFields: string[];
  /** Fallback sort when `sort` is absent or invalid. */
  defaultSort?: Record<string, 'asc' | 'desc'>;
  /**
   * If provided, filter/sort fields not in this list will throw 400.
   * Omit to skip validation (trust the caller).
   */
  allowedFields?: string[];
}

export interface BuiltPaginatedQuery {
  skip: number;
  take: number;
  where: Record<string, unknown>;
  orderBy: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export function buildPaginatedQuery(
  dto: PaginatedQueryDto,
  options: PaginatedQueryOptions,
): BuiltPaginatedQuery {
  const page = dto.page ?? 1;
  const limit = dto.limit ?? 10;

  const where = buildWhere(dto.search, dto.filters ?? null, options);
  const orderBy = buildOrderBy(dto.sort, options);

  return { skip: (page - 1) * limit, take: limit, where, orderBy };
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResponse<T> {
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildWhere(
  search: string | undefined,
  filters: QueryFiltersDto | null,
  { searchFields, allowedFields }: PaginatedQueryOptions,
): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  if (search?.trim() && searchFields.length) {
    conditions.push({
      OR: searchFields.map((f) => ({
        [f]: { contains: search.trim(), mode: Prisma.QueryMode.insensitive },
      })),
    });
  }

  const filtersWhere = buildFiltersWhere(filters, allowedFields);
  if (filtersWhere) conditions.push(filtersWhere);

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { AND: conditions };
}

function buildFiltersWhere(
  filters: QueryFiltersDto | null,
  allowedFields?: string[],
): Record<string, unknown> | undefined {
  if (!filters) return undefined;

  const conditions: Record<string, unknown>[] = [];

  if (filters.or?.length) {
    conditions.push({ OR: filters.or.map((f) => buildCondition(f, allowedFields)) });
  }
  if (filters.and?.length) {
    conditions.push({ AND: filters.and.map((f) => buildCondition(f, allowedFields)) });
  }

  if (!conditions.length) return undefined;
  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}

function buildCondition(
  { field, operator, value }: QueryFilterDto,
  allowedFields?: string[],
): Record<string, unknown> {
  if (allowedFields && !allowedFields.includes(field)) {
    throw new BadRequestException(`Filter field '${field}' is not allowed`);
  }

  const prismaCondition =
    operator === 'eq'
      ? value
      : operator === 'in'
        ? { in: Array.isArray(value) ? value : [value] }
        : operator === 'ne'
          ? { not: value }
          : { [operator]: value, ...(isStringOp(operator) ? { mode: Prisma.QueryMode.insensitive } : {}) };

  // Support dot-notation for relations: "role.name" → { role: { name: ... } }
  return resolveNestedField(field, prismaCondition);
}

function buildOrderBy(
  sort: PaginatedQueryDto['sort'],
  { defaultSort, allowedFields }: PaginatedQueryOptions,
): Record<string, unknown> {
  const fallback = defaultSort ?? { createdAt: 'desc' };
  if (!sort?.field) return fallback;

  if (allowedFields && !allowedFields.includes(sort.field)) {
    throw new BadRequestException(`Sort field '${sort.field}' is not allowed`);
  }

  return resolveNestedField(sort.field, sort.order);
}

/** Converts "role.name" + condition → { role: { name: condition } } */
function resolveNestedField(field: string, condition: unknown): Record<string, unknown> {
  const parts = field.split('.');
  return parts.reduceRight<Record<string, unknown>>(
    (acc, part) => ({ [part]: acc }),
    condition as Record<string, unknown>,
  );
}

function isStringOp(operator: string): boolean {
  return ['contains', 'startsWith', 'endsWith'].includes(operator);
}
