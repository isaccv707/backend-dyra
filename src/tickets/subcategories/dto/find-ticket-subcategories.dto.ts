import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Category } from '@prisma/client';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindTicketSubcategoriesDto extends PaginatedQueryDto {
  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @IsOptional()
  // Query params are strings: @Type(() => Boolean) turns "false" into true.
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;
}
