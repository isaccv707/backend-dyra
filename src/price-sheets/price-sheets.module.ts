import { Module } from '@nestjs/common';
import { PriceSheetsService } from './price-sheets.service';
import { PriceSheetsController } from './price-sheets.controller';
import { StudiesModule } from 'src/studies/studies.module';

@Module({
  imports: [StudiesModule],
  controllers: [PriceSheetsController],
  providers: [PriceSheetsService],
})
export class PriceSheetsModule {}
