import { Module } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { QuotationsController } from './quotations.controller';
import { QuotationPdfRenderer } from './pdf/quotation-pdf.renderer';
import { BranchesModule } from 'src/branches/branches.module';

@Module({
  imports: [BranchesModule],
  controllers: [QuotationsController],
  providers: [QuotationsService, QuotationPdfRenderer],
})
export class QuotationsModule {}
