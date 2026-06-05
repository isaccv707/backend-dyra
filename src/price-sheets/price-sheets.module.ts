import { Module } from '@nestjs/common';
import { PriceSheetsService } from './price-sheets.service';
import { PriceSheetsController } from './price-sheets.controller';

@Module({
  controllers: [PriceSheetsController],
  providers: [PriceSheetsService],
})
export class PriceSheetsModule {}
