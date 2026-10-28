import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateStudyProviderDto } from './create-study-provider.dto';

export class UpdateStudyProviderDto extends PartialType(
  OmitType(CreateStudyProviderDto, ['branchId'] as const),
) {}
