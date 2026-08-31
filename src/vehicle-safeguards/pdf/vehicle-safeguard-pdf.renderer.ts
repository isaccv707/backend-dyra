import { Injectable } from '@nestjs/common';
import { PdfDrawingKit, PdfLayout } from 'src/common/pdf/pdf-drawing.util';
import { VehicleSafeguardPdfData } from '../interfaces/vehicle-safeguard-pdf-interfaces';

const PAGE_LABEL = '1 de 2';
const REVISION_LABEL = '1';
const ELABORATED_LABEL = 'Julio de 2025';
const NEXT_REVISION_LABEL = 'Julio de 2028';

const LEGAL_TEXT =
  'He recibido de la empresa DIAGNÓSTICO Y REFERENCIA ANALÍTICA S.A. de C.V. el vehículo que se menciona en ' +
  'este documento. Este vehículo se entrega en óptimas condiciones para un uso adecuado. Me comprometo a ' +
  'cuidarlo y mantenerlo en buen estado, siendo utilizado únicamente dentro del ámbito laboral. Al término de ' +
  'la relación laboral se deberá regresar el vehículo aquí mencionado al jefe directo y/o recursos humanos. En ' +
  'caso de pérdida o robo, correrán a mi cargo los costos de reparación o reposición.';

const INSPECTION_INSTRUCTIONS =
  'Instrucciones: Indicar en la primera columna el estado en el que se encuentra (Bueno-Regular-Malo-No ' +
  'aplica) o (Vigente-No vigente-No aplica) y en la segunda las observaciones aplicables.';

@Injectable()
export class VehicleSafeguardPdfRenderer {
  constructor(private readonly kit: PdfDrawingKit) {}

  render(doc: PDFKit.PDFDocument, data: VehicleSafeguardPdfData): void {
    const layout = this.kit.buildLayout(doc);

    let y = this.drawHeader(doc, layout, data);
    y = this.drawInfoGrid(doc, layout, y, data);
    this.drawDocumentationSection(doc, layout, y, data);

    doc.addPage();
    this.drawInspectionPage(doc, layout, data);
  }

  // ===========================
  // ENCABEZADO
  // ===========================
  private drawHeader(doc: PDFKit.PDFDocument, layout: PdfLayout, data: VehicleSafeguardPdfData): number {
    return this.kit.drawFormHeader(doc, layout, {
      logoPath: data.meta.logoPath,
      companyName: data.meta.companyName,
      subtitle: 'RESGUARDO DE VEHÍCULO',
      docCode: data.meta.docCode,
      pageLabel: PAGE_LABEL,
      revisionLabel: REVISION_LABEL,
    });
  }

  // ===========================
  // GRILLA: datos del empleado + uso + resumen del vehículo (PÁGINA 1)
  // ===========================
  private drawInfoGrid(doc: PDFKit.PDFDocument, layout: PdfLayout, y: number, data: VehicleSafeguardPdfData): number {
    const { marginLeft, pageWidth, marginRight } = layout;
    const width = pageWidth - marginLeft - marginRight;

    const label1W = 130;
    const value1W = 226;
    const label2W = 60;
    const value2W = width - label1W - value1W - label2W;
    const rowHeight = this.kit.rowHeight;

    let cursor = y;

    cursor = this.kit.drawFourCellRow(doc, marginLeft, cursor, rowHeight, [
      { width: label1W, text: 'Nombre de usuario:', fill: true, bold: true },
      { width: value1W, text: data.employee.employeeName },
      { width: label2W, text: 'Fecha:', fill: true, bold: true },
      { width: value2W, text: data.meta.formattedDate },
    ]);

    cursor = this.kit.drawFourCellRow(doc, marginLeft, cursor, rowHeight, [
      { width: label1W, text: 'Puesto:', fill: true, bold: true },
      { width: value1W, text: data.employee.position },
      { width: label2W, text: 'Área:', fill: true, bold: true },
      { width: value2W, text: data.employee.area },
    ]);

    cursor = this.kit.drawToolsRow(doc, layout, cursor, [{ label: 'Automóvil', checked: true }]);
    cursor = this.kit.drawUsageRow(doc, layout, cursor, data.usage);
    cursor += 10;

    cursor = this.kit.drawSectionHeader(doc, layout, cursor, 'Vehículo');
    cursor = this.kit.drawTwoColumnRow(doc, layout, cursor, 'Marca', data.vehicle.brand, 'Modelo', data.vehicle.model);
    cursor = this.kit.drawTwoColumnRow(doc, layout, cursor, 'Kilometraje', data.vehicle.mileage, 'Núm. de placa', data.vehicle.plateNumber);
    cursor = this.kit.drawTwoColumnRow(doc, layout, cursor, 'Tipo de combustible', data.vehicle.fuelType, 'Transmisión', data.vehicle.transmission);
    cursor = this.kit.drawConditionRow(doc, layout, cursor, data.vehicle.conditionLabel);

    return cursor + 10;
  }

  // ===========================
  // DOCUMENTACIÓN DEL VEHÍCULO (PÁGINA 1, debajo del resumen — aprovecha el
  // espacio en blanco que quedaba tras los datos del vehículo)
  // ===========================
  private drawDocumentationSection(
    doc: PDFKit.PDFDocument,
    layout: PdfLayout,
    y: number,
    data: VehicleSafeguardPdfData,
  ): number {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#333333')
      .text(INSPECTION_INSTRUCTIONS, layout.marginLeft, y, {
        width: layout.pageWidth - layout.marginLeft - layout.marginRight,
      });

    const tableY = doc.y + 15;
    return this.kit.drawInspectionTable(doc, layout, tableY, 'Revisión', data.vehicle.revisionRows);
  }

  // ===========================
  // PÁGINA 2: INSPECCIÓN VEHICULAR + FIRMAS
  // ===========================
  private drawInspectionPage(doc: PDFKit.PDFDocument, layout: PdfLayout, data: VehicleSafeguardPdfData): void {
    let y = this.drawHeader(doc, layout, data);

    y = this.kit.drawTwoColumnInspectionTable(doc, layout, y, data.vehicle.inspectionRows);
    y += 25;

    this.kit.drawAcknowledgementFooter(doc, layout, y, LEGAL_TEXT, ELABORATED_LABEL, NEXT_REVISION_LABEL);
  }
}
