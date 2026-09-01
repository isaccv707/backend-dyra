import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class AttachmentDto {
  @IsUrl()
  url: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  fileType: string;
}
