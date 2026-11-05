import { Module } from '@nestjs/common';
import { VehicleCatalogService } from './vehicle-catalog.service';
import { VehicleCatalogController } from './vehicle-catalog.controller';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';
import { VehicleTransfersController } from './vehicle-transfers.controller';
import { VehicleAssignmentService } from './services/vehicle-assignment.service';
import { VehicleQueryService } from './services/vehicle-query.service';
import { VehicleSafeguardService } from './services/vehicle-safeguard.service';
import { VehicleTransferService } from './services/vehicle-transfer.service';
import { VehicleValidationService } from './services/vehicle-validation.service';
import { VehicleWriteService } from './services/vehicle-write.service';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { VehicleSafeguardsModule } from 'src/vehicle-safeguards/vehicle-safeguards.module';

@Module({
  imports: [PrismaModule, VehicleSafeguardsModule],
  controllers: [
    VehicleCatalogController,
    VehiclesController,
    VehicleTransfersController,
  ],
  providers: [
    VehicleCatalogService,
    VehiclesService,
    VehicleValidationService,
    VehicleSafeguardService,
    VehicleWriteService,
    VehicleQueryService,
    VehicleAssignmentService,
    VehicleTransferService,
  ],
  exports: [VehiclesService],
})
export class VehiclesModule {}
