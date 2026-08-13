import { Module } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { QuotationsController } from './quotations.controller';
import { QuotationPdfRenderer } from './pdf/quotation-pdf.renderer';

@Module({
  controllers: [QuotationsController],
  providers: [QuotationsService, QuotationPdfRenderer],
})
export class QuotationsModule {}
