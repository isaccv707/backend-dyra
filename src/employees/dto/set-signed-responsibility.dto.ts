import { IsBoolean, IsNotEmpty } from 'class-validator';

export class SetSignedResponsibilityDto {
  @IsBoolean()
  @IsNotEmpty()
  hasSignedResponsibility!: boolean;
}
