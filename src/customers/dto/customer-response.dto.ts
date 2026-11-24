import { ApiProperty } from '@nestjs/swagger';

export class CustomerPriceSheetDto {
  id!: string;
  name!: string;
  isActive!: boolean;
}

export class CustomerResponseDto {
  id!: string;
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  accountsReceivable!: boolean;
  liquidate!: boolean;
  isActive!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  contractAmount!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  patientAmount!: number | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-01-01' })
  startDate!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-12-31' })
  endDate!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  priceSheetId!: string | null;

  @ApiProperty({ type: CustomerPriceSheetDto, nullable: true })
  priceSheet!: CustomerPriceSheetDto | null;

  branchId!: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export class PaginatedCustomersResponseDto {
  @ApiProperty({ type: [CustomerResponseDto] })
  data!: CustomerResponseDto[];
  total!: number;
  page!: number;
  limit!: number;
  totalPages!: number;
}

export class CustomerImportRowErrorDto {
  /** Fila del Excel (la 1 es el encabezado). */
  row!: number;
  name?: string;
  errors!: string[];
}

export class CustomerImportResultDto {
  /** Filas leídas (sin contar el encabezado). */
  totalRows!: number;
  created!: number;
  updated!: number;
  @ApiProperty({ type: [CustomerImportRowErrorDto] })
  invalid!: CustomerImportRowErrorDto[];
}
