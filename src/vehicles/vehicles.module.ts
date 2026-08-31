import { Module } from '@nestjs/common';
import { VehicleCatalogService } from './vehicle-catalog.service';
import { VehicleCatalogController } from './vehicle-catalog.controller';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';
import { VehicleTransfersController } from './vehicle-transfers.controller';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { VehicleSafeguardsModule } from 'src/vehicle-safeguards/vehicle-safeguards.module';

@Module({
  imports: [PrismaModule, VehicleSafeguardsModule],
  controllers: [VehicleCatalogController, VehiclesController, VehicleTransfersController],
  providers: [VehicleCatalogService, VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
