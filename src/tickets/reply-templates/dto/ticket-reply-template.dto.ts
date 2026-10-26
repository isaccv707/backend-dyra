import { PartialType, PickType } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateTicketReplyTemplateDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;
}

/** The branch is fixed at creation. */
export class UpdateTicketReplyTemplateDto extends PartialType(
  PickType(CreateTicketReplyTemplateDto, ['title', 'body'] as const),
) {}

export class FindTicketReplyTemplatesDto {
  @IsUUID()
  branchId!: string;
}

export class TicketReplyTemplateDto {
  id!: string;
  branchId!: string;
  title!: string;
  body!: string;
  createdAt!: Date;
  updatedAt!: Date;
}
