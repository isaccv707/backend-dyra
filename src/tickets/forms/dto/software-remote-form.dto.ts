import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SoftwareRemoteFormDto {
  /** ID de TeamViewer del equipo a atender. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  teamViewerId!: string;
}
