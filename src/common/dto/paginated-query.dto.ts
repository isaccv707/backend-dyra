import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

const ALLOWED_OPERATORS = [
  'eq', 'ne', 'contains', 'startsWith', 'endsWith',
  'gt', 'gte', 'lt', 'lte', 'in',
] as const;

export type FilterOperator = (typeof ALLOWED_OPERATORS)[number];

export class QueryFilterDto {
  @IsString()
  @IsNotEmpty()
  field: string;

  @IsIn(ALLOWED_OPERATORS)
  operator: FilterOperator;

  @Allow()
  value: unknown;
}

export class QueryFiltersDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QueryFilterDto)
  or?: QueryFilterDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QueryFilterDto)
  and?: QueryFilterDto[];
}

export class QuerySortDto {
  @IsString()
  @IsNotEmpty()
  field: string;

  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc';
}

export class PaginatedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => QuerySortDto)
  sort?: QuerySortDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => QueryFiltersDto)
  filters?: QueryFiltersDto | null;
}
