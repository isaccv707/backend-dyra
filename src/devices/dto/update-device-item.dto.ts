import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateDeviceItemDto } from './create-device-item.dto';

export class UpdateDeviceItemDto extends PartialType(
  OmitType(CreateDeviceItemDto, [
    'currentBranchId',
    'employeeId',
    'locationId',
  ] as const),
) {}
