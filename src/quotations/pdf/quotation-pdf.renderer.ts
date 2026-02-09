// quotation-pdf.renderer.ts
import { Injectable } from '@nestjs/common';
import { PdfLayout, QuotationPdfData, StudyItem, Totals } from '../interfaces/quotations-interfaces';

const MAX_TABLE_Y = 720;
const TABLE_START_Y = 60;
const PRICE_COLUMN_WIDTH = 100;

@Injectable()
export class QuotationPdfRenderer {
    render(doc: PDFKit.PDFDocument, data: QuotationPdfData): void {
        const layout: PdfLayout = {
            pageWidth: doc.page.width,
            marginLeft: doc.page.margins.left,
            marginRight: doc.page.margins.right,
        };

        // Encabezado
        const headerLineY = this.drawHeader(doc, layout, data);

        // Datos del cliente
        const clientBottomY = this.drawClientSection(
            doc,
            layout,
            headerLineY,
            data.client,
        );

        // Tabla de estudios
        const tableBottomY = this.drawStudiesTable(
            doc,
            layout,
            clientBottomY,
            data.studies,
        );

        // Totales
        this.drawTotals(doc, layout, tableBottomY, data.totals);

        // Notas
        this.drawNotes(doc, layout);
    }

    // ===========================
    // HEADER
    // ===========================
    private drawHeader(
        doc: PDFKit.PDFDocument,
        layout: PdfLayout,
        data: QuotationPdfData,
    ): number {
        const { pageWidth, marginLeft, marginRight } = layout;
        const { meta, company } = data;

        // Referencia: margen superior de la página
        const topMarginY = doc.page.margins.top || 40;

        // Posiciones
        const logoTopY = topMarginY + 5;      // logo
        const headerTopY = topMarginY + 25;   // título + datos laboratorio
        const folioTopY = topMarginY;         // 👈 folio/fecha más arriba

        // Logo
        try {
            if (meta.logoPath) {
                doc.image(meta.logoPath, marginLeft, logoTopY, { width: 80 });
            }
        } catch (error) {
            console.warn('Error al cargar el logo para el PDF:', error);
        }

        // Título principal
        doc
            .font('Helvetica-Bold')
            .fontSize(18)
            .fillColor('#000000')
            .text(
                company.name,
                marginLeft + 90,
                headerTopY,
                {
                    width: pageWidth - marginLeft - marginRight - 200,
                    align: 'left',
                },
            );

        // Subtítulo y datos de la empresa
        doc
            .font('Helvetica')
            .fontSize(10)
            .fillColor('#555555')
            .text(company.subtitle, marginLeft + 90, headerTopY + 25)
            .text(`Dirección: ${company.address}`, marginLeft + 90, headerTopY + 40)
            .text(`Teléfono: ${company.phone}`, marginLeft + 90, headerTopY + 55)
            .text(`Correo: ${company.email}`, marginLeft + 90, headerTopY + 70);

        // Folio y fecha en la esquina superior derecha, más arriba
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

        // Línea divisoria
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


    // ===========================
    // CLIENTE
    // ===========================
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

    // ===========================
    // TABLA DE ESTUDIOS
    // ===========================
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
        const colStudyX = marginLeft + 10;

        // Última columna (importe total)
        const colTotalX = pageWidth - marginRight - PRICE_COLUMN_WIDTH;
        // Columna cantidad (más angosta)
        const quantityColumnWidth = 60;
        const colQuantityX = colTotalX - quantityColumnWidth;
        // Columna precio unitario
        const colUnitPriceX = colQuantityX - PRICE_COLUMN_WIDTH;

        // Encabezados
        doc.font('Helvetica-Bold').fontSize(11);
        doc.text('Estudio', colStudyX, tableTop);
        doc.text('P. unitario', colUnitPriceX, tableTop, {
            width: PRICE_COLUMN_WIDTH,
            align: 'right',
        });
        doc.text('Cantidad', colQuantityX, tableTop, {
            width: quantityColumnWidth,
            align: 'right',
        });
        doc.text('Importe', colTotalX, tableTop, {
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

        // Filas
        doc.font('Helvetica').fontSize(10).fillColor('#333333');

        let rowY = headerBottomY + 5;

        studies.forEach((study, index) => {
            if (rowY > MAX_TABLE_Y) {
                doc.addPage();
                rowY = TABLE_START_Y;
            }

            const lineTotal = study.price * study.quantity;

            // Estudio
            doc.text(`${index + 1}. ${study.name}`, colStudyX, rowY, {
                width: colUnitPriceX - colStudyX - 10,
            });

            // Precio unitario
            doc.text(
                `$${this.formatCurrency(study.price)} MXN`,
                colUnitPriceX,
                rowY,
                {
                    width: PRICE_COLUMN_WIDTH,
                    align: 'right',
                },
            );

            // Cantidad
            doc.text(
                String(study.quantity),
                colQuantityX,
                rowY,
                {
                    width: quantityColumnWidth,
                    align: 'right',
                },
            );

            // Importe (precio * cantidad)
            doc.text(
                `$${this.formatCurrency(lineTotal)} MXN`,
                colTotalX,
                rowY,
                {
                    width: PRICE_COLUMN_WIDTH,
                    align: 'right',
                },
            );

            rowY += 18;
        });

        doc
            .moveTo(marginLeft, rowY + 5)
            .lineTo(pageWidth - marginRight, rowY + 5)
            .lineWidth(0.5)
            .strokeColor('#CCCCCC')
            .stroke();

        return rowY + 5;
    }

    // ===========================
    // TOTALES
    // ===========================
    private drawTotals(
        doc: PDFKit.PDFDocument,
        layout: PdfLayout,
        tableBottomY: number,
        totals: Totals,
    ): void {
        const { pageWidth, marginRight } = layout;
        const { subtotal, total } = totals;

        const colPriceX = pageWidth - marginRight - PRICE_COLUMN_WIDTH;
        const totalsY = tableBottomY + 20;

        doc
            .font('Helvetica')
            .fontSize(11)
            .fillColor('#000000')
            .text(`Subtotal:`, colPriceX - 70, totalsY, {
                width: 70,
                align: 'right',
            })
            .text(
                `$${this.formatCurrency(subtotal)} MXN`,
                colPriceX,
                totalsY,
                {
                    width: PRICE_COLUMN_WIDTH,
                    align: 'right',
                },
            );
        doc
            .font('Helvetica')
            .fontSize(11)
            .fillColor('#000000')
            .text(`IVA:`, colPriceX - 70, totalsY + 18, {
                width: 70,
                align: 'right',
            })
            .text(`$${this.formatCurrency(total - subtotal)} MXN`, colPriceX, totalsY + 18, {
                width: PRICE_COLUMN_WIDTH,
                align: 'right',
            });

        doc
            .font('Helvetica-Bold')
            .fontSize(12)
            .fillColor('#000000')
            .text(`Total:`, colPriceX - 70, totalsY + 36, {
                width: 70,
                align: 'right',
            })
            .text(
                `$${this.formatCurrency(total)} MXN`,
                colPriceX,
                totalsY + 36,
                {
                    width: PRICE_COLUMN_WIDTH,
                    align: 'right',
                },
            );
    }

    private drawNotes(
        doc: PDFKit.PDFDocument,
        layout: PdfLayout,
    ): void {
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
    private formatCurrency(value: number): string {
        return value.toLocaleString('es-MX', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }
}
