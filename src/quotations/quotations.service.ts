// quotations.service.ts
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import {
  CompanyInfo,
  QuotationMeta,
  QuotationPdfData,
  StudyItem,
  Totals,
} from './interfaces/quotations-interfaces';
import { QuotationPdfRenderer } from './pdf/quotation-pdf.renderer';

const COMPANY_INFO: CompanyInfo = {
  name: 'Diagnóstico y Referencia Analítica',
  subtitle: 'Cotización de estudios de laboratorio',
  address: 'Lázaro Cárdenas',
  phone: '1234567890',
  email: 'diagnostico@gmail.com',
};

@Injectable()
export class QuotationsService {
  constructor(
    private readonly pdfRenderer: QuotationPdfRenderer,
  ) {}

  buildQuotationPdf(
    doc: PDFKit.PDFDocument,
    dto: CreateQuotationDto,
  ): void {
    const data = this.buildPdfData(dto);
    this.pdfRenderer.render(doc, data);
  }
  
  private buildPdfData(dto: CreateQuotationDto): QuotationPdfData {
    const { clientType, name, lastName, phoneNumber, email, studies } = dto;

    const totals = this.calculateTotals(studies);
    const metaBase = this.buildMeta(clientType);
    const logoPath = this.resolveLogoPath();

    const meta: QuotationMeta = {
      ...metaBase,
      logoPath,
    };

    return {
      meta,
      totals,
      client: {
        name,
        lastName,
        phoneNumber,
        email,
        clientType: meta.formattedClientType,
      },
      studies,
      company: COMPANY_INFO,
    };
  }

  // ===========================
  // CÁLCULOS Y METADATOS
  // ===========================
  private calculateTotals(studies: StudyItem[]): Totals {
    const total = studies.reduce(
      (acc, study) => acc + study.price * study.quantity,
      0,
    );

    const tax = total * 0.16;
    const subtotal = total - tax;

    return { subtotal, tax, total };
  }

  private buildMeta(clientType: string): Omit<QuotationMeta, 'logoPath'> {
    const now = new Date();

    const formattedDate = now.toLocaleDateString('es-MX');
    const folio = `DYRA-${now.getFullYear()}${(now.getMonth() + 1)
      .toString()
      .padStart(2, '0')}${now
        .getDate()
        .toString()
        .padStart(2, '0')}-${now.getTime().toString().slice(-4)}`;

    const formattedClientType =
      clientType.charAt(0).toUpperCase() +
      clientType.slice(1).toLowerCase();

    return {
      formattedDate,
      folio,
      formattedClientType,
    };
  }

  private resolveLogoPath(): string | null {
    const rootDir = process.cwd();

    const candidatePaths = [
      path.join(rootDir, 'dist', 'assets', 'logo.png'), // build
      path.join(rootDir, 'src', 'assets', 'logo.png'),  // dev
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    console.warn(
      'No se pudo cargar el logo para el PDF. Ninguna ruta encontrada:',
      candidatePaths,
    );

    return null;
  }
}
