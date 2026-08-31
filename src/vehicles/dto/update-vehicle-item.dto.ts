import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateVehicleItemDto } from './create-vehicle-item.dto';

// currentBranchId solo cambia por un traspaso; employeeId/locationId solo por
// los endpoints dedicados de asignación (ambos aplican la regla de exclusividad).
export class UpdateVehicleItemDto extends PartialType(
  OmitType(CreateVehicleItemDto, ['currentBranchId', 'employeeId', 'locationId'] as const),
) {}
