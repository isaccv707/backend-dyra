// src/quotations/quotations.controller.ts
import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import PDFDocument = require('pdfkit');
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { QuotationsService } from './quotations.service';
import { Public } from 'src/auth/decorators/public.decorator';

@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Public()
  @Post('pdf')
  generatePdf(@Body() dto: CreateQuotationDto, @Res() res: Response) {
    // 👇 AHORA SÍ, ESTO ES UN CONSTRUCTOR VÁLIDO
    const doc = new PDFDocument({ margin: 50 }) as PDFKit.PDFDocument;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'inline; filename="cotizacion-dyra.pdf"',
    );

    doc.pipe(res);

    this.quotationsService.buildQuotationPdf(doc, dto);

    doc.end();
  }
}
