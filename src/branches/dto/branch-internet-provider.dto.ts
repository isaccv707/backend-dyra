import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class BranchInternetProviderDto {
  @ApiProperty({ example: 'Telmex', description: 'Nombre del proveedor.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameProvider!: string;

  @ApiProperty({ example: '1234567890', description: 'Número de cuenta.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  accountNumber!: string;

  @ApiProperty({ example: 599.0, description: 'Precio mensual (MXN).' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyPrice!: number;
}
