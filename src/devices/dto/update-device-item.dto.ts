import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateDeviceItemDto } from './create-device-item.dto';

// currentBranchId solo cambia por un traspaso; employeeId/locationId solo por
// los endpoints dedicados de asignación (ambos aplican la regla de exclusividad).
export class UpdateDeviceItemDto extends PartialType(
  OmitType(CreateDeviceItemDto, ['currentBranchId', 'employeeId', 'locationId'] as const),
) {}
