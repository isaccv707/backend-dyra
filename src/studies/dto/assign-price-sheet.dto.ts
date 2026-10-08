import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class AssignPriceSheetDto {
  @IsString()
  @IsUUID()
  @IsNotEmpty()
  priceSheetId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  @IsBoolean()
  @IsOptional()
  showPrice?: boolean = true;
}
