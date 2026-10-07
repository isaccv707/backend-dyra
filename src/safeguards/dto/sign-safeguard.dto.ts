import { IsOptional, IsString } from 'class-validator';

export class SignSafeguardDto {
  @IsOptional()
  @IsString()
  signedDocumentPublicId?: string;
}
