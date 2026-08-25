import { Injectable } from '@nestjs/common';
import {
  ResguardoComputerInfo,
  ResguardoMobileInfo,
  ResguardoPdfData,
  ResguardoUsageInfo,
  ResguardoVehicleInfo,
  VehicleInspectionRow,
} from '../interfaces/resguardo-pdf-interfaces';

const SECTION_HEADER_COLOR = '#8DC63F';
const LABEL_FILL_COLOR = '#E0E0E0';
const BORDER_COLOR = '#999999';
const LABEL_WIDTH = 110;
const ROW_HEIGHT = 18;

// El formato físico (ADM.F.00) siempre trae "Página: 1 de 2" impreso igual
// en ambas páginas — no es un contador dinámico, se replica tal cual.
const PAGE_LABEL = '1 de 2';
const REVISION_LABEL = '1';

const LEGAL_TEXT =
  'He recibido de la empresa DIAGNÓSTICO Y REFERENCIA ANALÍTICA S.A. de C.V. el equipo de trabajo que se ' +
  'menciona en este documento. Este equipo se entrega en óptimas condiciones para un uso adecuado. Me ' +
  'comprometo a cuidarlo y mantenerlo en buen estado, siendo utilizado únicamente dentro del ámbito ' +
  'laboral. Al término de la relación laboral se deberá regresar cualquier equipo aquí mencionado al jefe ' +
  'directo y/o recursos humanos. En caso de pérdida o robo, correrán a mi cargo los costos de reparación o ' +
  'reposición.';

const INSPECTION_INSTRUCTIONS =
  'Instrucciones: Indicar en la primera columna el estado en el que se encuentra (Bueno-Regular-Malo-No ' +
  'aplica) o (Vigente-No vigente-No aplica) y en la segunda las observaciones aplicables.';

interface Layout {
  pageWidth: number;
  pageHeight: number;
  marginLeft: number;
  marginRight: number;
  marginBottom: number;
}

@Injectable()
export class ResguardoPdfRenderer {
  render(doc: PDFKit.PDFDocument, data: ResguardoPdfData): void {
    const layout = this.buildLayout(doc);

    let y = this.drawHeader(doc, layout, data);
    y = this.drawInfoGrid(doc, layout, y, data);

    if (data.computer) {
      y = this.drawComputerSection(doc, layout, y, data.computer);
    }
    if (data.mobile) {
      y = this.drawMobileSection(doc, layout, y, data.mobile);
    }
    if (data.vehicle) {
      this.drawVehicleSummarySection(doc, layout, y, data.vehicle);
      doc.addPage();
      this.drawVehicleInspectionPage(doc, layout, data);
    }
  }

  // ===========================
  // ENCABEZADO (se repite igual en cada página)
  // ===========================
  private drawHeader(doc: PDFKit.PDFDocument, layout: Layout, data: ResguardoPdfData): number {
    const { marginLeft, marginRight, pageWidth } = layout;
    const topY = doc.page.margins.top || 40;

    try {
      if (data.meta.logoPath) {
        doc.image(data.meta.logoPath, marginLeft, topY, { width: 60 });
      }
    } catch (error) {
      console.warn('Error al cargar el logo para el PDF de resguardo:', error);
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#000000')
      .text(data.meta.companyName, marginLeft + 70, topY, {
        width: pageWidth - marginLeft - marginRight - 220,
        align: 'left',
      });

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#555555')
      .text('FORMATOS', marginLeft + 70, topY + 20)
      .text('RESPONSIVA DE HERRAMIENTAS DE TRABAJO', marginLeft + 70, topY + 34);

    // Recuadro "Código / Página / Revisión" (3 filas, sin Fecha — la fecha
    // vive en la grilla de datos del empleado, no aquí).
    const boxWidth = 130;
    const boxX = pageWidth - marginRight - boxWidth;
    const boxY = topY;
    const boxRowHeight = 20;
    const boxHeight = boxRowHeight * 3;
    const labelColWidth = 55;

    doc.rect(boxX, boxY, boxWidth, boxHeight).lineWidth(0.7).strokeColor('#000000').stroke();
    for (let i = 1; i < 3; i++) {
      doc
        .moveTo(boxX, boxY + boxRowHeight * i)
        .lineTo(boxX + boxWidth, boxY + boxRowHeight * i)
        .strokeColor('#000000')
        .lineWidth(0.7)
        .stroke();
    }
    doc
      .moveTo(boxX + labelColWidth, boxY)
      .lineTo(boxX + labelColWidth, boxY + boxHeight)
      .strokeColor('#000000')
      .lineWidth(0.7)
      .stroke();

    const boxRows: [string, string][] = [
      ['Código:', data.meta.docCode],
      ['Página:', PAGE_LABEL],
      ['Revisión:', REVISION_LABEL],
    ];
    boxRows.forEach(([label, value], i) => {
      const rowY = boxY + boxRowHeight * i;
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#000000')
        .text(label, boxX + 4, rowY + 6, { width: labelColWidth - 6 });
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#000000')
        .text(value, boxX + labelColWidth + 4, rowY + 6, { width: boxWidth - labelColWidth - 8 });
    });

    const lineY = topY + 65;
    doc
      .moveTo(marginLeft, lineY)
      .lineTo(pageWidth - marginRight, lineY)
      .lineWidth(1)
      .strokeColor(BORDER_COLOR)
      .stroke();

    return lineY + 12;
  }

  // ===========================
  // GRILLA: datos del empleado + herramientas a asignar + uso
  // ===========================
  private drawInfoGrid(doc: PDFKit.PDFDocument, layout: Layout, y: number, data: ResguardoPdfData): number {
    const { marginLeft, marginRight, pageWidth } = layout;
    const width = pageWidth - marginLeft - marginRight;

    const label1W = 130;
    const value1W = 226;
    const label2W = 60;
    const value2W = width - label1W - value1W - label2W;

    let cursor = y;

    cursor = this.drawFourCellRow(
      doc,
      marginLeft,
      cursor,
      ROW_HEIGHT,
      [
        { width: label1W, text: 'Nombre de usuario:', fill: true, bold: true },
        { width: value1W, text: data.employee.employeeName },
        { width: label2W, text: 'Fecha:', fill: true, bold: true },
        { width: value2W, text: data.meta.formattedDate },
      ],
    );

    cursor = this.drawFourCellRow(
      doc,
      marginLeft,
      cursor,
      ROW_HEIGHT,
      [
        { width: label1W, text: 'Puesto:', fill: true, bold: true },
        { width: value1W, text: data.employee.position },
        { width: label2W, text: 'Área:', fill: true, bold: true },
        { width: value2W, text: data.employee.area },
      ],
    );

    const wideLabelW = 190;
    const contentW = width - wideLabelW;
    const toolsRowHeight = 24;

    this.drawCell(doc, marginLeft, cursor, wideLabelW, toolsRowHeight, {
      fill: true,
      lines: ['Herramientas a asignar:', '(Seleccionar con una x)'],
      bold: true,
    });
    this.drawCell(doc, marginLeft + wideLabelW, cursor, contentW, toolsRowHeight, {});
    this.drawCheckboxLabel(doc, marginLeft + wideLabelW + 10, cursor + 7, 'Computadora', Boolean(data.computer));
    this.drawCheckboxLabel(doc, marginLeft + wideLabelW + 150, cursor + 7, 'Celular', Boolean(data.mobile));
    this.drawCheckboxLabel(doc, marginLeft + wideLabelW + 260, cursor + 7, 'Automóvil', Boolean(data.vehicle));
    cursor += toolsRowHeight;

    const usageRowHeight = 24;
    this.drawCell(doc, marginLeft, cursor, wideLabelW, usageRowHeight, {
      fill: true,
      lines: ['Uso:', '(Seleccionar con una x)'],
      bold: true,
    });
    this.drawCell(doc, marginLeft + wideLabelW, cursor, contentW, usageRowHeight, {});
    this.drawCheckboxLabel(doc, marginLeft + wideLabelW + 10, cursor + 7, 'Temporal', data.usage.usageType === 'TEMPORARY');
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#333333')
      .text(`Fecha de inicio: ${data.usage.formattedStartDate ?? ''}`, marginLeft + wideLabelW + 90, cursor + 4, {
        width: 150,
      })
      .text(`Fecha de término: ${data.usage.formattedEndDate ?? ''}`, marginLeft + wideLabelW + 90, cursor + 14, {
        width: 150,
      });
    this.drawCheckboxLabel(doc, marginLeft + wideLabelW + 260, cursor + 7, 'Permanente', data.usage.usageType === 'PERMANENT');
    cursor += usageRowHeight;

    return cursor + 10;
  }

  // ===========================
  // SECCIONES DE EQUIPO (PÁGINA 1)
  // ===========================
  private drawComputerSection(doc: PDFKit.PDFDocument, layout: Layout, y: number, computer: ResguardoComputerInfo): number {
    let cursor = this.drawSectionHeader(doc, layout, y, 'Equipo de cómputo');

    cursor = this.drawTwoColumnRow(doc, layout, cursor, 'Marca', computer.brand, 'Modelo', computer.model);
    cursor = this.drawTwoColumnRow(doc, layout, cursor, 'No. serie', computer.serialNumber, 'Código interno', computer.internalCode);
    cursor = this.drawTwoColumnRow(doc, layout, cursor, 'Disco duro', computer.hardDrive, 'Procesador', computer.processor);
    cursor = this.drawFullRow(doc, layout, cursor, 'Accesorios incluidos', computer.accessories);
    cursor = this.drawConditionRow(doc, layout, cursor, computer.conditionLabel);
    cursor = this.drawFullRow(doc, layout, cursor, 'Observaciones', computer.observations);

    return cursor + 10;
  }

  private drawMobileSection(doc: PDFKit.PDFDocument, layout: Layout, y: number, mobile: ResguardoMobileInfo): number {
    let cursor = this.drawSectionHeader(doc, layout, y, 'Equipo celular');

    cursor = this.drawTwoColumnRow(doc, layout, cursor, 'Marca', mobile.brand, 'Modelo', mobile.model);
    cursor = this.drawTwoColumnRow(doc, layout, cursor, 'IMEI', mobile.imei, 'Número', mobile.phoneNumber);
    cursor = this.drawFullRow(doc, layout, cursor, 'Accesorios incluidos', mobile.accessories);
    cursor = this.drawConditionRow(doc, layout, cursor, mobile.conditionLabel);
    cursor = this.drawFullRow(doc, layout, cursor, 'Observaciones', mobile.observations);

    return cursor + 10;
  }

  private drawVehicleSummarySection(doc: PDFKit.PDFDocument, layout: Layout, y: number, vehicle: ResguardoVehicleInfo): number {
    let cursor = this.drawSectionHeader(doc, layout, y, 'Equipo vehicular');

    cursor = this.drawTwoColumnRow(doc, layout, cursor, 'Marca', vehicle.brand, 'Modelo', vehicle.model);
    cursor = this.drawTwoColumnRow(doc, layout, cursor, 'Kilometraje', vehicle.mileage, 'Núm. de placa', vehicle.plateNumber);
    cursor = this.drawTwoColumnRow(doc, layout, cursor, 'Tipo de combustible', vehicle.fuelType, 'Transmisión', vehicle.transmission);
    cursor = this.drawConditionRow(doc, layout, cursor, vehicle.conditionLabel);

    return cursor + 10;
  }

  // ===========================
  // PÁGINA 2: INSPECCIÓN VEHICULAR
  // ===========================
  private drawVehicleInspectionPage(doc: PDFKit.PDFDocument, layout: Layout, data: ResguardoPdfData): void {
    const vehicle = data.vehicle!;
    let y = this.drawHeader(doc, layout, data);

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#333333')
      .text(INSPECTION_INSTRUCTIONS, layout.marginLeft, y, {
        width: layout.pageWidth - layout.marginLeft - layout.marginRight,
      });

    y = doc.y + 15;

    y = this.drawInspectionTable(doc, layout, y, 'Revisión', vehicle.revisionRows);
    y += 20;
    y = this.drawTwoColumnInspectionTable(doc, layout, y, vehicle.inspectionRows);

    y += 25;
    if (y > layout.pageHeight - layout.marginBottom - 120) {
      doc.addPage();
      y = doc.page.margins.top || 40;
    }

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#000000')
      .text(LEGAL_TEXT, layout.marginLeft, y, {
        width: layout.pageWidth - layout.marginLeft - layout.marginRight,
        align: 'justify',
      });

    const signatureY = doc.y + 40;
    this.drawSignatureLine(doc, layout.marginLeft, signatureY, 200, 'Nombre y firma de quién recibe');
    this.drawSignatureLine(
      doc,
      layout.pageWidth - layout.marginRight - 200,
      signatureY,
      200,
      'Nombre y firma de quién entrega',
    );
  }

  // Tabla de una sola columna de rubros (usada para "Revisión").
  private drawInspectionTable(
    doc: PDFKit.PDFDocument,
    layout: Layout,
    startY: number,
    title: string,
    rows: VehicleInspectionRow[],
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
  private drawTwoColumnInspectionTable(
    doc: PDFKit.PDFDocument,
    layout: Layout,
    startY: number,
    rows: VehicleInspectionRow[],
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

  // ===========================
  // HELPERS DE DIBUJO
  // ===========================
  private drawSectionHeader(doc: PDFKit.PDFDocument, layout: Layout, y: number, title: string): number {
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

  private drawTwoColumnRow(
    doc: PDFKit.PDFDocument,
    layout: Layout,
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

  private drawFullRow(doc: PDFKit.PDFDocument, layout: Layout, y: number, label: string, value: string): number {
    const { marginLeft, marginRight, pageWidth } = layout;
    const width = pageWidth - marginLeft - marginRight;
    const valueWidth = width - LABEL_WIDTH;
    const height = Math.max(ROW_HEIGHT, doc.heightOfString(value || ' ', { width: valueWidth - 8 }) + 8);

    this.drawCell(doc, marginLeft, y, LABEL_WIDTH, height, { text: label, bold: true, fill: true });
    this.drawCell(doc, marginLeft + LABEL_WIDTH, y, valueWidth, height, { text: value });

    return y + height;
  }

  private drawConditionRow(doc: PDFKit.PDFDocument, layout: Layout, y: number, conditionLabel: string): number {
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
  private drawCell(
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

  // segments de una fila de 4 celdas (label/value/label/value) tipo "Nombre
  // de usuario / Fecha" — cada segmento define su propio ancho y estilo.
  private drawFourCellRow(
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

  private drawCheckboxLabel(doc: PDFKit.PDFDocument, x: number, y: number, label: string, checked: boolean): void {
    const boxSize = 10;

    doc.rect(x, y, boxSize, boxSize).strokeColor('#000000').lineWidth(0.7).stroke();
    if (checked) {
      doc
        .moveTo(x + 1.5, y + 1.5)
        .lineTo(x + boxSize - 1.5, y + boxSize - 1.5)
        .moveTo(x + boxSize - 1.5, y + 1.5)
        .lineTo(x + 1.5, y + boxSize - 1.5)
        .strokeColor('#000000')
        .lineWidth(1)
        .stroke();
    }

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#000000')
      .text(label, x + boxSize + 5, y - 1);
  }

  private drawSignatureLine(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string): void {
    doc.moveTo(x, y).lineTo(x + width, y).strokeColor('#000000').lineWidth(0.7).stroke();
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#000000')
      .text(label, x, y + 4, { width, align: 'center' });
  }

  private buildLayout(doc: PDFKit.PDFDocument): Layout {
    return {
      pageWidth: doc.page.width,
      pageHeight: doc.page.height,
      marginLeft: doc.page.margins.left,
      marginRight: doc.page.margins.right,
      marginBottom: doc.page.margins.bottom,
    };
  }
}
