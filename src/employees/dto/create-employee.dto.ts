import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsString()
  @IsNotEmpty()
  department!: string;

  @IsString()
  @IsUUID()
  @IsNotEmpty()
  branchId!: string;

  /** Firmó la responsiva vigente de equipo (cómputo/celular). */
  @IsOptional()
  @IsBoolean()
  hasSignedResponsibility?: boolean;

  /** Firmó la responsiva vigente de vehículo. */
  @IsOptional()
  @IsBoolean()
  hasSignedVehicleResponsibility?: boolean;
}
