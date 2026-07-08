import { IsBoolean, IsEnum, IsOptional, Matches } from 'class-validator';
import { DayOfWeek } from '@prisma/client';

export class CreateBranchScheduleDto {
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'openTime must be in HH:mm format',
  })
  openTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'closeTime must be in HH:mm format',
  })
  closeTime?: string;

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;
}
