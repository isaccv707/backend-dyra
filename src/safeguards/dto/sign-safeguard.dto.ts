import { IsOptional, IsString } from 'class-validator';

// signedDocumentPublicId es el public_id de Cloudinary (subido por el
// frontend con type: authenticated, resource_type: raw) del PDF firmado
// escaneado. Es opcional para cubrir también la confirmación manual de
// firma sin documento adjunto.
export class SignSafeguardDto {
  @IsOptional()
  @IsString()
  signedDocumentPublicId?: string;
}
