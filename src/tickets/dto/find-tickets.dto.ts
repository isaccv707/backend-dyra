import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Category, TicketPriority, TicketStatus } from '@prisma/client';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindTicketsDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsUUID()
  assignedToId?: string;
}
