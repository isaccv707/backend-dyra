import { Injectable } from '@nestjs/common';
import { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { FindQuotationsDto } from './dto/find-quotations.dto';
import { QuotationCreateService } from './services/quotation-create.service';
import { QuotationPdfService } from './services/quotation-pdf.service';
import { QuotationRecordsService } from './services/quotation-records.service';
import { QuotationWithItems } from './types/quotation.types';

/**
 * Entry point of quotations for the controller (public PDF route of the site
 * and admin routes). Holds no logic: each operation lives in `services/`.
 */
@Injectable()
export class QuotationsService {
  constructor(
    private readonly creation: QuotationCreateService,
    private readonly records: QuotationRecordsService,
    private readonly pdf: QuotationPdfService,
  ) {}

  create(dto: CreateQuotationDto): Promise<QuotationWithItems> {
    return this.creation.create(dto);
  }

  createForAdmin(
    dto: CreateQuotationDto,
    user: BranchScopedUser,
  ): Promise<QuotationWithItems> {
    return this.creation.createForAdmin(dto, user);
  }

  findAll(dto: FindQuotationsDto, user: BranchScopedUser) {
    return this.records.findAll(dto, user);
  }

  findOne(id: string, user: BranchScopedUser): Promise<QuotationWithItems> {
    return this.records.findOne(id, user);
  }

  remove(id: string, user: BranchScopedUser) {
    return this.records.remove(id, user);
  }

  buildQuotationPdf(
    doc: PDFKit.PDFDocument,
    quotation: QuotationWithItems,
  ): void {
    this.pdf.buildQuotationPdf(doc, quotation);
  }
}
