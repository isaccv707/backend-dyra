import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateVehicleItemDto } from './create-vehicle-item.dto';

export class UpdateVehicleItemDto extends PartialType(
  OmitType(CreateVehicleItemDto, [
    'currentBranchId',
    'employeeId',
    'locationId',
  ] as const),
) {}
