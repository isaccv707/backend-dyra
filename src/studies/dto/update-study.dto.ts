import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateStudyDto } from './create-study.dto';

export class UpdateStudyDto extends PartialType(
  OmitType(CreateStudyDto, ['studyPrices'] as const),
) {}
