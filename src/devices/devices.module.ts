import { Module } from '@nestjs/common';
import { DeviceCatalogService } from './device-catalog.service';
import { DeviceCatalogController } from './device-catalog.controller';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { TransfersController } from './transfers.controller';
import { DeviceAssignmentService } from './services/device-assignment.service';
import { DeviceQueryService } from './services/device-query.service';
import { DeviceSafeguardService } from './services/device-safeguard.service';
import { DeviceTransferService } from './services/device-transfer.service';
import { DeviceValidationService } from './services/device-validation.service';
import { DeviceWriteService } from './services/device-write.service';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { SafeguardsModule } from 'src/safeguards/safeguards.module';

@Module({
  imports: [PrismaModule, SafeguardsModule],
  controllers: [
    DeviceCatalogController,
    DevicesController,
    TransfersController,
  ],
  providers: [
    DeviceCatalogService,
    DevicesService,
    DeviceValidationService,
    DeviceSafeguardService,
    DeviceWriteService,
    DeviceQueryService,
    DeviceAssignmentService,
    DeviceTransferService,
  ],
  exports: [DevicesService],
})
export class DevicesModule {}
