// quotation-pdf.renderer.ts
import { Injectable } from '@nestjs/common';
import { PdfLayout, QuotationPdfData, StudyItem, Totals } from '../interfaces/quotations-interfaces';

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
        const { colStudyX, colUnitPriceX, colQuantityX, colSubtotalX, colTotalX } =
            this.computeTableColumns(layout);

        // Encabezados
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

        // Filas
        doc.font('Helvetica').fontSize(10).fillColor('#333333');

        let rowY = headerBottomY + 5;

        studies.forEach((study, index) => {
            if (rowY > MAX_TABLE_Y) {
                doc.addPage();
                rowY = TABLE_START_Y;
            }

            // El precio unitario ya incluye IVA; el total de línea es
            // precio * cantidad, y el subtotal de línea se desglosa de ahí.
            const lineTotal = study.price * study.quantity;
            const lineSubtotal = this.roundCurrency(lineTotal / (1 + IVA_RATE));

            // Estudio: código a la izquierda del nombre, truncado a una sola
            // línea (con "…" si no cabe) para que nunca invada la fila de
            // abajo, sin importar qué tan largo sea el nombre del estudio.
            // (pdfkit solo trunca automáticamente con `ellipsis` cuando se
            // fija `height`; sin eso, `width` por sí solo sigue partiendo el
            // texto en varias líneas, así que truncamos a mano.)
            const codePrefix = study.code ? `${study.code} - ` : '';
            const studyLabel = `${index + 1}. ${codePrefix}${study.name}`;
            const studyColumnWidth = colUnitPriceX - colStudyX - 10;
            doc.text(this.truncateToWidth(doc, studyLabel, studyColumnWidth), colStudyX, rowY, {
                width: studyColumnWidth,
                lineBreak: false,
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
                    width: QUANTITY_COLUMN_WIDTH,
                    align: 'right',
                },
            );

            // Subtotal de línea (precio * cantidad, sin IVA)
            doc.text(
                `$${this.formatCurrency(lineSubtotal)} MXN`,
                colSubtotalX,
                rowY,
                {
                    width: PRICE_COLUMN_WIDTH,
                    align: 'right',
                },
            );

            // Total de línea (precio * cantidad, con IVA)
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
        const { subtotal, total } = totals;

        // Alineado bajo la columna "Total" de la tabla de estudios.
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

    // Columnas de la tabla de estudios ancladas a la izquierda (a partir del
    // nombre del estudio) en vez de al margen derecho de la página, para no
    // dejar un hueco enorme entre "Estudio" y las columnas de importes
    // cuando los nombres de los estudios son cortos.
    private computeTableColumns(layout: PdfLayout): TableColumns {
        const { marginLeft } = layout;

        const colStudyX = marginLeft + 10;
        const colUnitPriceX = colStudyX + STUDY_COLUMN_WIDTH;
        const colQuantityX = colUnitPriceX + PRICE_COLUMN_WIDTH;
        const colSubtotalX = colQuantityX + QUANTITY_COLUMN_WIDTH;
        const colTotalX = colSubtotalX + PRICE_COLUMN_WIDTH;

        return { colStudyX, colUnitPriceX, colQuantityX, colSubtotalX, colTotalX };
    }

    // Recorta `text` carácter por carácter (según el ancho real de fuente
    // activo en `doc`) hasta que quepa en `maxWidth`, agregando "…" al
    // final si hubo que recortar.
    private truncateToWidth(doc: PDFKit.PDFDocument, text: string, maxWidth: number): string {
        if (doc.widthOfString(text) <= maxWidth) {
            return text;
        }

        const ellipsis = '…';
        let truncated = text;
        while (truncated.length > 0 && doc.widthOfString(truncated + ellipsis) > maxWidth) {
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
