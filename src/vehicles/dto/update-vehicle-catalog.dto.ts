import { PartialType } from '@nestjs/mapped-types';
import { CreateVehicleCatalogDto } from './create-vehicle-catalog.dto';

export class UpdateVehicleCatalogDto extends PartialType(CreateVehicleCatalogDto) {}
