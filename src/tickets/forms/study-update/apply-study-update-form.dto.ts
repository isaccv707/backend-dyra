import { OmitType, PartialType } from '@nestjs/mapped-types';
import { ApplyStudyCreateFormDto } from '../study-create/apply-study-create-form.dto';

export class ApplyStudyUpdateFormDto extends PartialType(
  OmitType(ApplyStudyCreateFormDto, ['newStudies'] as const),
) {}
