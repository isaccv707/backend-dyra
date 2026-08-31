import { Injectable } from '@nestjs/common';

export interface PdfLayout {
  pageWidth: number;
  pageHeight: number;
  marginLeft: number;
  marginRight: number;
  marginBottom: number;
}

export interface PdfInspectionRow {
  label: string;
  state: string;
  observations: string;
}

const SECTION_HEADER_COLOR = '#8DC63F';
const LABEL_FILL_COLOR = '#E0E0E0';
const BORDER_COLOR = '#999999';
const LABEL_WIDTH = 110;
const ROW_HEIGHT = 18;
const WIDE_LABEL_WIDTH = 190;
const CHECKBOX_COLOR = '#5B9B23';

// Primitivas de dibujo genéricas (celdas, grillas, checkboxes, tablas de
// inspección) para documentos PDF con pdfkit — sin conocimiento de dominio.
// Las usan tanto SafeguardPdfRenderer (IT) como VehicleSafeguardPdfRenderer
// (Flotilla); lo que sí varía entre documentos (encabezado, texto legal,
// composición de secciones) vive en cada renderer, no aquí.
@Injectable()
export class PdfDrawingKit {
  readonly rowHeight = ROW_HEIGHT;
  readonly labelWidth = LABEL_WIDTH;

  buildLayout(doc: PDFKit.PDFDocument): PdfLayout {
    return {
      pageWidth: doc.page.width,
      pageHeight: doc.page.height,
      marginLeft: doc.page.margins.left,
      marginRight: doc.page.margins.right,
      marginBottom: doc.page.margins.bottom,
    };
  }

  drawSectionHeader(doc: PDFKit.PDFDocument, layout: PdfLayout, y: number, title: string): number {
    const { marginLeft, marginRight, pageWidth } = layout;
    const width = pageWidth - marginLeft - marginRight;

    doc.rect(marginLeft, y, width, ROW_HEIGHT).fill(SECTION_HEADER_COLOR);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#000000')
      .text(title, marginLeft + 5, y + 4);

    return y + ROW_HEIGHT;
  }

  drawTwoColumnRow(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    y: number,
    label1: string,
    value1: string,
    label2: string,
    value2: string,
  ): number {
    const { marginLeft, marginRight, pageWidth } = layout;
    const width = pageWidth - marginLeft - marginRight;
    const halfWidth = width / 2;

    this.drawCell(doc, marginLeft, y, LABEL_WIDTH, ROW_HEIGHT, { text: label1, bold: true, fill: true });
    this.drawCell(doc, marginLeft + LABEL_WIDTH, y, halfWidth - LABEL_WIDTH, ROW_HEIGHT, { text: value1 });
    this.drawCell(doc, marginLeft + halfWidth, y, LABEL_WIDTH, ROW_HEIGHT, { text: label2, bold: true, fill: true });
    this.drawCell(doc, marginLeft + halfWidth + LABEL_WIDTH, y, width - halfWidth - LABEL_WIDTH, ROW_HEIGHT, { text: value2 });

    return y + ROW_HEIGHT;
  }

  drawFullRow(doc: PDFKit.PDFDocument, layout: PdfLayout, y: number, label: string, value: string): number {
    const { marginLeft, marginRight, pageWidth } = layout;
    const width = pageWidth - marginLeft - marginRight;
    const valueWidth = width - LABEL_WIDTH;
    const height = Math.max(ROW_HEIGHT, doc.heightOfString(value || ' ', { width: valueWidth - 8 }) + 8);

    this.drawCell(doc, marginLeft, y, LABEL_WIDTH, height, { text: label, bold: true, fill: true });
    this.drawCell(doc, marginLeft + LABEL_WIDTH, y, valueWidth, height, { text: value });

    return y + height;
  }

  drawConditionRow(doc: PDFKit.PDFDocument, layout: PdfLayout, y: number, conditionLabel: string): number {
    const { marginLeft, marginRight, pageWidth } = layout;
    const width = pageWidth - marginLeft - marginRight;
    const valueWidth = width - LABEL_WIDTH;

    this.drawCell(doc, marginLeft, y, LABEL_WIDTH, ROW_HEIGHT, { text: 'Estado físico', bold: true, fill: true });
    this.drawCell(doc, marginLeft + LABEL_WIDTH, y, valueWidth, ROW_HEIGHT, {});

    this.drawCheckboxLabel(doc, marginLeft + LABEL_WIDTH + 10, y + 4, 'Nuevo', conditionLabel === 'Nuevo');
    this.drawCheckboxLabel(doc, marginLeft + LABEL_WIDTH + 110, y + 4, 'Seminuevo', conditionLabel === 'Seminuevo');

    return y + ROW_HEIGHT;
  }

  // Celda genérica con borde, relleno gris opcional (para etiquetas) y texto
  // en una o varias líneas — bloque base de toda la grilla del documento.
  drawCell(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    height: number,
    opts: { text?: string; lines?: string[]; bold?: boolean; fill?: boolean; align?: 'left' | 'center' },
  ): void {
    if (opts.fill) {
      doc.rect(x, y, width, height).fill(LABEL_FILL_COLOR);
    }
    doc.rect(x, y, width, height).strokeColor(BORDER_COLOR).lineWidth(0.5).stroke();

    const lines = opts.lines ?? (opts.text ? [opts.text] : []);
    if (!lines.length) return;

    doc
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9)
      .fillColor('#000000');

    lines.forEach((line, i) => {
      doc.text(line, x + 4, y + 5 + i * 11, { width: width - 8, align: opts.align ?? 'left' });
    });
  }

  // Segmentos de una fila de 4 celdas (label/value/label/value) tipo "Nombre
  // de usuario / Fecha" — cada segmento define su propio ancho y estilo.
  drawFourCellRow(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    height: number,
    segments: { width: number; text: string; fill?: boolean; bold?: boolean }[],
  ): number {
    let cursorX = x;
    for (const segment of segments) {
      this.drawCell(doc, cursorX, y, segment.width, height, {
        text: segment.text,
        bold: segment.bold,
        fill: segment.fill,
      });
      cursorX += segment.width;
    }
    return y + height;
  }

  drawCheckboxLabel(doc: PDFKit.PDFDocument, x: number, y: number, label: string, checked: boolean): void {
    const boxSize = 10;

    doc.rect(x, y, boxSize, boxSize).strokeColor(CHECKBOX_COLOR).lineWidth(1).stroke();
    if (checked) {
      doc
        .moveTo(x + 1.5, y + 1.5)
        .lineTo(x + boxSize - 1.5, y + boxSize - 1.5)
        .moveTo(x + boxSize - 1.5, y + 1.5)
        .lineTo(x + 1.5, y + boxSize - 1.5)
        .strokeColor(CHECKBOX_COLOR)
        .lineWidth(1.2)
        .stroke();
    }

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#000000')
      .text(label, x + boxSize + 5, y - 1);
  }

  // Fila "Herramientas a asignar": lista de opciones (Computadora/Celular
  // para equipo, Automóvil para vehículo) repartidas en partes iguales sobre
  // el ancho de la celda de contenido — cada documento pasa solo las opciones
  // que le aplican.
  drawToolsRow(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    y: number,
    options: { label: string; checked: boolean }[],
  ): number {
    const { marginLeft, marginRight, pageWidth } = layout;
    const width = pageWidth - marginLeft - marginRight;
    const labelW = WIDE_LABEL_WIDTH;
    const contentW = width - labelW;
    const rowHeight = 24;

    this.drawCell(doc, marginLeft, y, labelW, rowHeight, {
      fill: true,
      lines: ['Herramientas a asignar:', '(Seleccionar con una x)'],
      bold: true,
    });
    this.drawCell(doc, marginLeft + labelW, y, contentW, rowHeight, {});

    const slotWidth = contentW / options.length;
    options.forEach((option, i) => {
      this.drawCheckboxLabel(doc, marginLeft + labelW + slotWidth * i + 10, y + 7, option.label, option.checked);
    });

    return y + rowHeight;
  }

  // Fila "Uso": tres subceldas con sus propios bordes — Temporal | fechas de
  // inicio/término | Permanente — igual en ambos documentos.
  drawUsageRow(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    y: number,
    usage: {
      usageType: 'TEMPORARY' | 'PERMANENT';
      formattedStartDate: string | null;
      formattedEndDate: string | null;
    },
  ): number {
    const { marginLeft, marginRight, pageWidth } = layout;
    const width = pageWidth - marginLeft - marginRight;
    const labelW = WIDE_LABEL_WIDTH;
    const contentW = width - labelW;
    const rowHeight = 24;

    const tempColW = 85;
    const permColW = 100;
    const dateColW = contentW - tempColW - permColW;

    this.drawCell(doc, marginLeft, y, labelW, rowHeight, {
      fill: true,
      lines: ['Uso:', '(Seleccionar con una x)'],
      bold: true,
    });

    const tempX = marginLeft + labelW;
    const dateX = tempX + tempColW;
    const permX = dateX + dateColW;

    this.drawCell(doc, tempX, y, tempColW, rowHeight, {});
    this.drawCell(doc, dateX, y, dateColW, rowHeight, {});
    this.drawCell(doc, permX, y, permColW, rowHeight, {});

    this.drawCheckboxLabel(doc, tempX + 8, y + 7, 'Temporal', usage.usageType === 'TEMPORARY');
    this.drawCheckboxLabel(doc, permX + 8, y + 7, 'Permanente', usage.usageType === 'PERMANENT');

    const dateTextWidth = dateColW - 10;
    const startLine = `Fecha de inicio: ${usage.formattedStartDate ?? ''}`;
    const endLine = `Fecha de término: ${usage.formattedEndDate ?? ''}`;
    doc.font('Helvetica').fontSize(8).fillColor('#333333');
    const startLineHeight = doc.heightOfString(startLine, { width: dateTextWidth });
    doc
      .text(startLine, dateX + 5, y + 3, { width: dateTextWidth })
      .text(endLine, dateX + 5, y + 3 + startLineHeight + 1, { width: dateTextWidth });

    return y + rowHeight;
  }

  drawSignatureLine(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string): void {
    doc.moveTo(x, y).lineTo(x + width, y).strokeColor('#000000').lineWidth(0.7).stroke();
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#000000')
      .text(label, x, y + 4, { width, align: 'center' });
  }

  // Pie de página fijo del formato físico: aviso de propiedad (izquierda) +
  // fechas de elaboración/próxima revisión (derecha) — igual en ambos
  // documentos (equipo y vehículo), tal como en el formato impreso.
  drawDocumentFooter(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    y: number,
    elaboratedLabel: string,
    nextRevisionLabel: string,
  ): number {
    const { marginLeft, marginRight, pageWidth } = layout;
    const width = pageWidth - marginLeft - marginRight;
    const rightWidth = 170;
    const leftWidth = width - rightWidth;

    doc
      .font('Helvetica-BoldOblique')
      .fontSize(8)
      .fillColor('#000000')
      .text(
        'Este documento es propiedad de Diagnóstico y Referencia Analítica S.A de C.V., queda prohibida su reproducción parcial o total',
        marginLeft,
        y,
        { width: leftWidth - 10 },
      );

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#000000')
      .text(`Elaborado: ${elaboratedLabel}`, marginLeft + leftWidth, y, { width: rightWidth, align: 'right' })
      .text(`Próxima revisión: ${nextRevisionLabel}`, marginLeft + leftWidth, y + 10, {
        width: rightWidth,
        align: 'right',
      });

    return Math.max(doc.y, y + 20);
  }

  // Bloque de firmas: texto legal + dos líneas de firma + pie de propiedad,
  // siempre anclado al fondo de la página (como un verdadero pie de página)
  // sin importar cuánto contenido lo precede. Si el contenido ya invadió el
  // espacio reservado, se recorre a una página nueva y se ancla ahí.
  drawAcknowledgementFooter(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    contentY: number,
    legalText: string,
    elaboratedLabel: string,
    nextRevisionLabel: string,
  ): void {
    const { marginLeft, marginRight, pageWidth, pageHeight, marginBottom } = layout;
    const contentWidth = pageWidth - marginLeft - marginRight;

    const SIGNATURE_GAP = 40;
    const SIGNATURE_HEIGHT = 15;
    const FOOTER_GAP = 30;
    const DOC_FOOTER_HEIGHT = 24;

    const legalTextHeight = doc.heightOfString(legalText, { width: contentWidth, align: 'justify' });
    const blockHeight = legalTextHeight + SIGNATURE_GAP + SIGNATURE_HEIGHT + FOOTER_GAP + DOC_FOOTER_HEIGHT;

    let footerY = pageHeight - marginBottom - blockHeight;
    if (contentY > footerY) {
      doc.addPage();
      footerY = pageHeight - marginBottom - blockHeight;
    }

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#000000')
      .text(legalText, marginLeft, footerY, { width: contentWidth, align: 'justify' });

    const signatureY = footerY + legalTextHeight + SIGNATURE_GAP;
    this.drawSignatureLine(doc, marginLeft, signatureY, 200, 'Nombre y firma de quién recibe');
    this.drawSignatureLine(doc, pageWidth - marginRight - 200, signatureY, 200, 'Nombre y firma de quién entrega');

    this.drawDocumentFooter(doc, layout, signatureY + FOOTER_GAP, elaboratedLabel, nextRevisionLabel);
  }

  // Encabezado del formato físico: logo | razón social + FORMATOS + subtítulo
  // | caja Código/Página/Revisión, las tres columnas dentro de un único
  // recuadro — igual en ambos documentos (equipo y vehículo).
  drawFormHeader(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    opts: {
      logoPath: string | null;
      companyName: string;
      subtitle: string;
      docCode: string;
      pageLabel: string;
      revisionLabel: string;
    },
  ): number {
    const { marginLeft, marginRight, pageWidth } = layout;
    const topY = doc.page.margins.top || 40;
    const width = pageWidth - marginLeft - marginRight;

    const logoColWidth = 85;
    const codeColWidth = 130;
    const codeLabelColWidth = 55;
    const infoColWidth = width - logoColWidth - codeColWidth;
    const headerHeight = 70;
    const codeRowHeight = headerHeight / 3;

    doc.rect(marginLeft, topY, width, headerHeight).lineWidth(0.7).strokeColor('#000000').stroke();

    const infoX = marginLeft + logoColWidth;
    const codeX = infoX + infoColWidth;
    [infoX, codeX].forEach((dividerX) => {
      doc
        .moveTo(dividerX, topY)
        .lineTo(dividerX, topY + headerHeight)
        .strokeColor('#000000')
        .lineWidth(0.7)
        .stroke();
    });

    try {
      if (opts.logoPath) {
        doc.image(opts.logoPath, marginLeft + 4, topY + 4, {
          fit: [logoColWidth - 8, headerHeight - 8],
          align: 'center',
          valign: 'center',
        });
      }
    } catch (error) {
      console.warn('Error al cargar el logo para el PDF:', error);
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#000000')
      .text(opts.companyName, infoX + 6, topY + 12, { width: infoColWidth - 12, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#333333')
      .text('FORMATOS', infoX + 6, topY + 32, { width: infoColWidth - 12, align: 'center' })
      .text(opts.subtitle, infoX + 6, topY + 45, { width: infoColWidth - 12, align: 'center' });

    for (let i = 1; i < 3; i++) {
      doc
        .moveTo(codeX, topY + codeRowHeight * i)
        .lineTo(codeX + codeColWidth, topY + codeRowHeight * i)
        .strokeColor('#000000')
        .lineWidth(0.7)
        .stroke();
    }
    doc
      .moveTo(codeX + codeLabelColWidth, topY)
      .lineTo(codeX + codeLabelColWidth, topY + headerHeight)
      .strokeColor('#000000')
      .lineWidth(0.7)
      .stroke();

    const codeRows: [string, string][] = [
      ['Código:', opts.docCode],
      ['Página:', opts.pageLabel],
      ['Revisión:', opts.revisionLabel],
    ];
    codeRows.forEach(([label, value], i) => {
      const rowY = topY + codeRowHeight * i;
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#000000')
        .text(label, codeX + 4, rowY + codeRowHeight / 2 - 5, { width: codeLabelColWidth - 6 });
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#000000')
        .text(value, codeX + codeLabelColWidth + 4, rowY + codeRowHeight / 2 - 5, {
          width: codeColWidth - codeLabelColWidth - 8,
        });
    });

    return topY + headerHeight + 15;
  }

  // Tabla de una sola columna de rubros (usada para "Revisión").
  drawInspectionTable(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    startY: number,
    title: string,
    rows: PdfInspectionRow[],
  ): number {
    const { marginLeft, pageWidth, marginRight, pageHeight, marginBottom } = layout;
    const tableWidth = pageWidth - marginLeft - marginRight;
    const colLabelWidth = tableWidth * 0.4;
    const colStateWidth = tableWidth * 0.25;
    const colObsWidth = tableWidth - colLabelWidth - colStateWidth;

    let y = startY;
    if (y > pageHeight - marginBottom - 60) {
      doc.addPage();
      y = doc.page.margins.top || 40;
    }

    const drawHeaderRow = (headerY: number) => {
      this.drawCell(doc, marginLeft, headerY, colLabelWidth, ROW_HEIGHT, { text: title, bold: true, fill: true });
      this.drawCell(doc, marginLeft + colLabelWidth, headerY, colStateWidth, ROW_HEIGHT, { text: 'Estado', bold: true, fill: true, align: 'center' });
      this.drawCell(doc, marginLeft + colLabelWidth + colStateWidth, headerY, colObsWidth, ROW_HEIGHT, { text: 'Observaciones', bold: true, fill: true, align: 'center' });
    };

    drawHeaderRow(y);
    y += ROW_HEIGHT;

    for (const row of rows) {
      if (y > pageHeight - marginBottom - ROW_HEIGHT) {
        doc.addPage();
        y = doc.page.margins.top || 40;
        drawHeaderRow(y);
        y += ROW_HEIGHT;
      }

      this.drawCell(doc, marginLeft, y, colLabelWidth, ROW_HEIGHT, { text: row.label, bold: true, fill: true });
      this.drawCell(doc, marginLeft + colLabelWidth, y, colStateWidth, ROW_HEIGHT, { text: row.state });
      this.drawCell(doc, marginLeft + colLabelWidth + colStateWidth, y, colObsWidth, ROW_HEIGHT, { text: row.observations });

      y += ROW_HEIGHT;
    }

    return y;
  }

  // Tabla de dos columnas de rubros lado a lado (usada para "Inspección"):
  // Inspección|Estado|Observaciones repetido dos veces, izquierda y derecha.
  drawTwoColumnInspectionTable(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    startY: number,
    rows: PdfInspectionRow[],
  ): number {
    const { marginLeft, pageWidth, marginRight, pageHeight, marginBottom } = layout;
    const tableWidth = pageWidth - marginLeft - marginRight;
    const halfWidth = tableWidth / 2;
    const colLabelWidth = halfWidth * 0.4;
    const colStateWidth = halfWidth * 0.25;
    const colObsWidth = halfWidth - colLabelWidth - colStateWidth;
    const rightX = marginLeft + halfWidth;

    const half = Math.ceil(rows.length / 2);
    const leftRows = rows.slice(0, half);
    const rightRows = rows.slice(half);
    const rowCount = Math.max(leftRows.length, rightRows.length);

    let y = startY;
    if (y > pageHeight - marginBottom - 60) {
      doc.addPage();
      y = doc.page.margins.top || 40;
    }

    const drawSide = (x: number, headerY: number) => {
      this.drawCell(doc, x, headerY, colLabelWidth, ROW_HEIGHT, { text: 'Inspección', bold: true, fill: true });
      this.drawCell(doc, x + colLabelWidth, headerY, colStateWidth, ROW_HEIGHT, { text: 'Estado', bold: true, fill: true, align: 'center' });
      this.drawCell(doc, x + colLabelWidth + colStateWidth, headerY, colObsWidth, ROW_HEIGHT, { text: 'Observaciones', bold: true, fill: true, align: 'center' });
    };

    drawSide(marginLeft, y);
    drawSide(rightX, y);
    y += ROW_HEIGHT;

    for (let i = 0; i < rowCount; i++) {
      if (y > pageHeight - marginBottom - ROW_HEIGHT) {
        doc.addPage();
        y = doc.page.margins.top || 40;
        drawSide(marginLeft, y);
        drawSide(rightX, y);
        y += ROW_HEIGHT;
      }

      const left = leftRows[i];
      const right = rightRows[i];

      if (left) {
        this.drawCell(doc, marginLeft, y, colLabelWidth, ROW_HEIGHT, { text: left.label, bold: true, fill: true });
        this.drawCell(doc, marginLeft + colLabelWidth, y, colStateWidth, ROW_HEIGHT, { text: left.state });
        this.drawCell(doc, marginLeft + colLabelWidth + colStateWidth, y, colObsWidth, ROW_HEIGHT, { text: left.observations });
      }
      if (right) {
        this.drawCell(doc, rightX, y, colLabelWidth, ROW_HEIGHT, { text: right.label, bold: true, fill: true });
        this.drawCell(doc, rightX + colLabelWidth, y, colStateWidth, ROW_HEIGHT, { text: right.state });
        this.drawCell(doc, rightX + colLabelWidth + colStateWidth, y, colObsWidth, ROW_HEIGHT, { text: right.observations });
      }

      y += ROW_HEIGHT;
    }

    return y;
  }
}
