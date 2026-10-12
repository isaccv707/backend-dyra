import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateStudyCatalogDto } from './create-study-catalog.dto';

export class UpdateStudyCatalogDto extends PartialType(
  OmitType(CreateStudyCatalogDto, ['branchId'] as const),
) {}
