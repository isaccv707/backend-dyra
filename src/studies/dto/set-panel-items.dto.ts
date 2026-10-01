import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class PanelItemDto {
  @IsNotEmpty()
  @IsUUID()
  childId!: string;

  // Si no se envía, se usa la posición dentro de `items`.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;
}

export class SetPanelItemsDto {
  // Reemplaza la lista completa; [] deja el perfil sin hijos.
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => PanelItemDto)
  items!: PanelItemDto[];
}
