import { IsOptional, IsString, IsUUID } from 'class-validator';

// Exactamente uno de los dos debe llegar; la exclusividad (nunca ambos, y
// nunca ninguno) se valida en DevicesService, no alcanza con el DTO.
export class AssignDeviceDto {
  @IsOptional()
  @IsString()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  locationId?: string;
}
