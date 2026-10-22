import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class AccessRequestFormDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  email!: string;

  /** Rol a asignar (ver GET /tickets/form-options/roles). */
  @IsUUID()
  roleId!: string;

  /** Sucursal a asignar. */
  @IsUUID()
  branchId!: string;
}

/** IT may assign a different role than the requested one when approving. */
export class ApplyAccessRequestFormDto {
  @IsOptional()
  @IsUUID()
  roleId?: string;
}
