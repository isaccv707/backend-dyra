import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PanelComponentSnapshot } from 'src/studies/utils/panel-tree.util';
import {
  CompanyInfo,
  QuotationMeta,
  QuotationPdfData,
} from '../interfaces/quotations-interfaces';
import { QuotationPdfRenderer } from '../pdf/quotation-pdf.renderer';
import { QuotationBranch, QuotationWithItems } from '../types/quotation.types';

const QUOTATION_SUBTITLE = 'Cotización de estudios de laboratorio';

/** Maps a quotation (with its branch letterhead) to the PDF and renders it. */
@Injectable()
export class QuotationPdfService {
  constructor(private readonly pdfRenderer: QuotationPdfRenderer) {}

  buildQuotationPdf(
    doc: PDFKit.PDFDocument,
    quotation: QuotationWithItems,
  ): void {
    const data = this.buildPdfData(quotation);
    this.pdfRenderer.render(doc, data);
  }

  private buildPdfData(quotation: QuotationWithItems): QuotationPdfData {
    const meta: QuotationMeta = {
      formattedDate: quotation.createdAt.toLocaleDateString('es-MX'),
      folio: quotation.folio,
      formattedClientType: this.formatClientType(quotation.clientType),
      logoPath: this.resolveLogoPath(),
    };

    return {
      meta,
      totals: {
        subtotal: Number(quotation.subtotal),
        tax: Number(quotation.tax),
        total: Number(quotation.total),
      },
      client: {
        name: quotation.name,
        lastName: quotation.lastName ?? undefined,
        phoneNumber: quotation.phoneNumber,
        email: quotation.email ?? '',
        clientType: meta.formattedClientType,
      },
      studies: quotation.items.map((item) => ({
        name: item.name,
        code: item.code,
        price: Number(item.price),
        quantity: item.quantity,
        components: Array.isArray(item.components)
          ? (item.components as PanelComponentSnapshot[])
          : [],
      })),
      company: this.buildCompanyInfo(quotation.branch),
    };
  }

  private buildCompanyInfo(branch: QuotationBranch): CompanyInfo {
    return {
      name: branch.name,
      subtitle: QUOTATION_SUBTITLE,
      address: this.formatBranchAddress(branch.address),
      phone: branch.phone ?? '',
      email: branch.email ?? '',
    };
  }

  private formatBranchAddress(address: QuotationBranch['address']): string {
    const streetLine = address.intNumber
      ? `${address.street} #${address.extNumber} Int. ${address.intNumber}`
      : `${address.street} #${address.extNumber}`;

    return [streetLine, address.neighborhood, address.city]
      .filter((part): part is string => Boolean(part))
      .join(', ');
  }

  private formatClientType(clientType: string): string {
    return (
      clientType.charAt(0).toUpperCase() + clientType.slice(1).toLowerCase()
    );
  }

  private resolveLogoPath(): string | null {
    const rootDir = process.cwd();

    const candidatePaths = [
      path.join(rootDir, 'dist', 'assets', 'logo.png'),
      path.join(rootDir, 'src', 'assets', 'logo.png'),
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
