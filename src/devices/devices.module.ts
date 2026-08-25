import { Module } from '@nestjs/common';
import { DeviceCatalogService } from './device-catalog.service';
import { DeviceCatalogController } from './device-catalog.controller';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { TransfersController } from './transfers.controller';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { ResguardosModule } from 'src/resguardos/resguardos.module';

@Module({
  imports: [PrismaModule, ResguardosModule],
  controllers: [DeviceCatalogController, DevicesController, TransfersController],
  providers: [DeviceCatalogService, DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
