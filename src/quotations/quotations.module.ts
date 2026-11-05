import { Module } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { QuotationsController } from './quotations.controller';
import { QuotationPdfRenderer } from './pdf/quotation-pdf.renderer';
import { QuotationCreateService } from './services/quotation-create.service';
import { QuotationPdfService } from './services/quotation-pdf.service';
import { QuotationRecordsService } from './services/quotation-records.service';

@Module({
  controllers: [QuotationsController],
  providers: [
    QuotationsService,
    QuotationPdfRenderer,
    QuotationCreateService,
    QuotationRecordsService,
    QuotationPdfService,
  ],
})
export class QuotationsModule {}
