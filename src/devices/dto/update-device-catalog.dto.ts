import { PartialType } from '@nestjs/mapped-types';
import { CreateDeviceCatalogDto } from './create-device-catalog.dto';

export class UpdateDeviceCatalogDto extends PartialType(CreateDeviceCatalogDto) {}
