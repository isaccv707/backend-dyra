import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerExcelService } from './services/customer-excel.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomerExcelService],
  // Used by the CogniTI ticket forms (CLIENT_CREATE / CLIENT_UPDATE).
  exports: [CustomersService],
})
export class CustomersModule {}
