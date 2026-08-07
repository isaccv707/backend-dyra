import { Module } from '@nestjs/common';
import { DeviceCatalogService } from './device-catalog.service';
import { DeviceCatalogController } from './device-catalog.controller';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { TransfersController } from './transfers.controller';
import { PrismaModule } from 'prisma/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DeviceCatalogController, DevicesController, TransfersController],
  providers: [DeviceCatalogService, DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
