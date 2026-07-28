import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class AssignPriceSheetDto {
  @IsString()
  @IsUUID()
  @IsNotEmpty()
  priceSheetId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  price!: number;

  @IsBoolean()
  @IsOptional()
  showPrice?: boolean = true;
}
