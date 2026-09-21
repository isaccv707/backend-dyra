import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateTicketSubcategoryDto } from './create-ticket-subcategory.dto';

export class UpdateTicketSubcategoryDto extends PartialType(
  CreateTicketSubcategoryDto,
) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
