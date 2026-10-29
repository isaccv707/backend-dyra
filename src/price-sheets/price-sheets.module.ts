import { Module } from '@nestjs/common';
import { PriceSheetsService } from './price-sheets.service';
import { PriceSheetsController } from './price-sheets.controller';
import { PriceSheetPriceImportService } from './price-sheet-price-import.service';

@Module({
  controllers: [PriceSheetsController],
  providers: [PriceSheetsService, PriceSheetPriceImportService],
})
export class PriceSheetsModule {}
