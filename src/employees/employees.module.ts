import { Module } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { DevicesModule } from 'src/devices/devices.module';
import { SafeguardsModule } from 'src/safeguards/safeguards.module';
import { VehiclesModule } from 'src/vehicles/vehicles.module';
import { VehicleSafeguardsModule } from 'src/vehicle-safeguards/vehicle-safeguards.module';

@Module({
  imports: [PrismaModule, DevicesModule, SafeguardsModule, VehiclesModule, VehicleSafeguardsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
