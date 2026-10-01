import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateStudyCatalogDto } from './create-study-catalog.dto';

// La sucursal no se puede cambiar: los estudios que ya usan el registro
// quedarían apuntando a un catálogo de otra sucursal.
export class UpdateStudyCatalogDto extends PartialType(
  OmitType(CreateStudyCatalogDto, ['branchId'] as const),
) {}
