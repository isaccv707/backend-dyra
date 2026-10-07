import { IsOptional, IsString } from 'class-validator';

export class SignVehicleSafeguardDto {
  @IsOptional()
  @IsString()
  signedDocumentPublicId?: string;
}
