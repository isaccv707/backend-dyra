import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateTicketCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;

  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;

  /**
   * Users to notify by name (GET /tickets/:id/mentionable-users): participants
   * and TI of the branch; on an internal note, TI only.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  mentionedUserIds?: string[];
}

export class FindMentionableUsersDto {
  /** Mentions for an internal note: TI only. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  internal?: boolean;
}
