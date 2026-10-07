import { Injectable } from '@nestjs/common';
import {
  PdfLayout,
  QuotationPdfData,
  StudyItem,
  Totals,
} from '../interfaces/quotations-interfaces';

const MAX_TABLE_Y = 720;
const TABLE_START_Y = 60;
const PRICE_COLUMN_WIDTH = 80;
const QUANTITY_COLUMN_WIDTH = 65;
const STUDY_COLUMN_WIDTH = 175;
const IVA_RATE = 0.16;

interface TableColumns {
  colStudyX: number;
  colUnitPriceX: number;
  colQuantityX: number;
  colSubtotalX: number;
  colTotalX: number;
}

@Injectable()
export class QuotationPdfRenderer {
  render(doc: PDFKit.PDFDocument, data: QuotationPdfData): void {
    const layout: PdfLayout = {
      pageWidth: doc.page.width,
      marginLeft: doc.page.margins.left,
      marginRight: doc.page.margins.right,
    };

    const headerLineY = this.drawHeader(doc, layout, data);

    const clientBottomY = this.drawClientSection(
      doc,
      layout,
      headerLineY,
      data.client,
    );

    const tableBottomY = this.drawStudiesTable(
      doc,
      layout,
      clientBottomY,
      data.studies,
    );

    this.drawTotals(doc, layout, tableBottomY, data.totals);

    this.drawNotes(doc, layout);
  }

  private drawHeader(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    data: QuotationPdfData,
  ): number {
    const { pageWidth, marginLeft, marginRight } = layout;
    const { meta, company } = data;

    const topMarginY = doc.page.margins.top || 40;

    const logoTopY = topMarginY + 5;
    const headerTopY = topMarginY + 25;
    const folioTopY = topMarginY;

    try {
      if (meta.logoPath) {
        doc.image(meta.logoPath, marginLeft, logoTopY, { width: 80 });
      }
    } catch (error) {
      console.warn('Error al cargar el logo para el PDF:', error);
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor('#000000')
      .text(company.name, marginLeft + 90, headerTopY, {
        width: pageWidth - marginLeft - marginRight - 200,
        align: 'left',
      });

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#555555')
      .text(company.subtitle, marginLeft + 90, headerTopY + 25)
      .text(`Dirección: ${company.address}`, marginLeft + 90, headerTopY + 40)
      .text(`Teléfono: ${company.phone}`, marginLeft + 90, headerTopY + 55)
      .text(`Correo: ${company.email}`, marginLeft + 90, headerTopY + 70);

    const rightBlockX = pageWidth - marginRight - 140;

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#000000')
      .text(`Folio: ${meta.folio}`, rightBlockX, folioTopY, {
        width: 140,
        align: 'right',
      })
      .text(`Fecha: ${meta.formattedDate}`, rightBlockX, folioTopY + 15, {
        width: 140,
        align: 'right',
      });

    const lineY = headerTopY + 90;

    doc
      .moveTo(marginLeft, lineY)
      .lineTo(pageWidth - marginRight, lineY)
      .lineWidth(1)
      .strokeColor('#CCCCCC')
      .stroke();

    doc.moveDown(2);

    return lineY;
  }

  private drawClientSection(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    headerLineY: number,
    client: QuotationPdfData['client'],
  ): number {
    const { marginLeft } = layout;
    const { name, lastName, phoneNumber, email, clientType } = client;

    const clientBlockY = headerLineY + 15;

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#000000')
      .text('Datos del cliente', marginLeft, clientBlockY);

    doc.moveDown(0.5);

    doc.font('Helvetica').fontSize(11).fillColor('#333333');

    doc.text(`Tipo de cliente: ${clientType}`);
    doc.text(`Nombre: ${name} ${lastName ?? ''}`);
    doc.text(`Teléfono: ${phoneNumber}`);
    doc.text(`Correo electrónico: ${email}`);

    doc.moveDown(1.5);

    return doc.y;
  }

  private drawStudiesTable(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    clientBottomY: number,
    studies: StudyItem[],
  ): number {
    const { marginLeft, marginRight, pageWidth } = layout;

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#000000')
      .text('Estudios cotizados', marginLeft);

    doc.moveDown(0.5);

    const tableTop = doc.y + 5;
    const { colStudyX, colUnitPriceX, colQuantityX, colSubtotalX, colTotalX } =
      this.computeTableColumns(layout);

    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('Estudio', colStudyX, tableTop);
    doc.text('P. unitario', colUnitPriceX, tableTop, {
      width: PRICE_COLUMN_WIDTH,
      align: 'right',
    });
    doc.text('Cantidad', colQuantityX, tableTop, {
      width: QUANTITY_COLUMN_WIDTH,
      align: 'right',
    });
    doc.text('Subtotal', colSubtotalX, tableTop, {
      width: PRICE_COLUMN_WIDTH,
      align: 'right',
    });
    doc.text('Total', colTotalX, tableTop, {
      width: PRICE_COLUMN_WIDTH,
      align: 'right',
    });

    const headerBottomY = tableTop + 18;
    doc
      .moveTo(marginLeft, headerBottomY)
      .lineTo(pageWidth - marginRight, headerBottomY)
      .lineWidth(0.5)
      .strokeColor('#CCCCCC')
      .stroke();

    doc.font('Helvetica').fontSize(10).fillColor('#333333');

    let rowY = headerBottomY + 5;

    studies.forEach((study, index) => {
      if (rowY > MAX_TABLE_Y) {
        doc.addPage();
        rowY = TABLE_START_Y;
      }

      const lineTotal = study.price * study.quantity;
      const lineSubtotal = this.roundCurrency(lineTotal / (1 + IVA_RATE));

      const codePrefix = study.code ? `${study.code} - ` : '';
      const studyLabel = `${index + 1}. ${codePrefix}${study.name}`;
      const studyColumnWidth = colUnitPriceX - colStudyX - 10;
      doc.text(
        this.truncateToWidth(doc, studyLabel, studyColumnWidth),
        colStudyX,
        rowY,
        {
          width: studyColumnWidth,
          lineBreak: false,
        },
      );

      doc.text(
        `$${this.formatCurrency(study.price)} MXN`,
        colUnitPriceX,
        rowY,
        {
          width: PRICE_COLUMN_WIDTH,
          align: 'right',
        },
      );

      doc.text(String(study.quantity), colQuantityX, rowY, {
        width: QUANTITY_COLUMN_WIDTH,
        align: 'right',
      });

      doc.text(
        `$${this.formatCurrency(lineSubtotal)} MXN`,
        colSubtotalX,
        rowY,
        {
          width: PRICE_COLUMN_WIDTH,
          align: 'right',
        },
      );

      doc.text(`$${this.formatCurrency(lineTotal)} MXN`, colTotalX, rowY, {
        width: PRICE_COLUMN_WIDTH,
        align: 'right',
      });

      rowY += 18;

      if (study.components.length) {
        doc.fontSize(8.5).fillColor('#777777');
        for (const component of study.components) {
          if (rowY > MAX_TABLE_Y) {
            doc.addPage();
            rowY = TABLE_START_Y;
          }
          const indent = 14 * component.level;
          const width = studyColumnWidth - indent;
          doc.text(
            this.truncateToWidth(
              doc,
              `• ${component.code} - ${component.name}`,
              width,
            ),
            colStudyX + indent,
            rowY,
            { width, lineBreak: false },
          );
          rowY += 12;
        }
        doc.fontSize(10).fillColor('#333333');
        rowY += 4;
      }
    });

    doc
      .moveTo(marginLeft, rowY + 5)
      .lineTo(pageWidth - marginRight, rowY + 5)
      .lineWidth(0.5)
      .strokeColor('#CCCCCC')
      .stroke();

    return rowY + 5;
  }

  private drawTotals(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    tableBottomY: number,
    totals: Totals,
  ): void {
    const { subtotal, total } = totals;

    const { colTotalX: colPriceX } = this.computeTableColumns(layout);
    const totalsY = tableBottomY + 20;

    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#000000')
      .text(`Subtotal:`, colPriceX - 70, totalsY, {
        width: 70,
        align: 'right',
      })
      .text(`$${this.formatCurrency(subtotal)} MXN`, colPriceX, totalsY, {
        width: PRICE_COLUMN_WIDTH,
        align: 'right',
      });
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#000000')
      .text(`IVA:`, colPriceX - 70, totalsY + 18, {
        width: 70,
        align: 'right',
      })
      .text(
        `$${this.formatCurrency(total - subtotal)} MXN`,
        colPriceX,
        totalsY + 18,
        {
          width: PRICE_COLUMN_WIDTH,
          align: 'right',
        },
      );

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#000000')
      .text(`Total:`, colPriceX - 70, totalsY + 36, {
        width: 70,
        align: 'right',
      })
      .text(`$${this.formatCurrency(total)} MXN`, colPriceX, totalsY + 36, {
        width: PRICE_COLUMN_WIDTH,
        align: 'right',
      });
  }

  private drawNotes(doc: PDFKit.PDFDocument, layout: PdfLayout): void {
    const { marginLeft, marginRight, pageWidth } = layout;

    doc.moveDown(3);

    const noteX = marginLeft;
    const noteWidth = pageWidth - marginLeft - marginRight;

    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor('#555555')
      .text(
        'Esta cotización es informativa y puede estar sujeta a cambios sin previo aviso.',
        noteX,
        doc.y,
        {
          align: 'center',
          width: noteWidth,
        },
      )
      .moveDown(0.5)
      .text(
        'Por favor, comunícate con nosotros para confirmar precios, tiempos de entrega y preparación.',
        noteX,
        doc.y,
        {
          align: 'center',
          width: noteWidth,
        },
      );
  }

  private computeTableColumns(layout: PdfLayout): TableColumns {
    const { marginLeft } = layout;

    const colStudyX = marginLeft + 10;
    const colUnitPriceX = colStudyX + STUDY_COLUMN_WIDTH;
    const colQuantityX = colUnitPriceX + PRICE_COLUMN_WIDTH;
    const colSubtotalX = colQuantityX + QUANTITY_COLUMN_WIDTH;
    const colTotalX = colSubtotalX + PRICE_COLUMN_WIDTH;

    return { colStudyX, colUnitPriceX, colQuantityX, colSubtotalX, colTotalX };
  }

  private truncateToWidth(
    doc: PDFKit.PDFDocument,
    text: string,
    maxWidth: number,
  ): string {
    if (doc.widthOfString(text) <= maxWidth) {
      return text;
    }

    const ellipsis = '…';
    let truncated = text;
    while (
      truncated.length > 0 &&
      doc.widthOfString(truncated + ellipsis) > maxWidth
    ) {
      truncated = truncated.slice(0, -1);
    }

    return truncated.length > 0 ? truncated + ellipsis : ellipsis;
  }

  private formatCurrency(value: number): string {
    return value.toLocaleString('es-MX', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
