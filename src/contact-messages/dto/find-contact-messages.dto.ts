import { ContactMessageStatus, ContactMessageSubject } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindContactMessagesDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsEnum(ContactMessageStatus)
  status?: ContactMessageStatus;

  @IsOptional()
  @IsEnum(ContactMessageSubject)
  subject?: ContactMessageSubject;
}

export class ContactMessagesPendingCountQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
