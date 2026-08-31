import { Injectable } from '@nestjs/common';
import { PdfDrawingKit, PdfLayout } from 'src/common/pdf/pdf-drawing.util';
import {
  SafeguardComputerInfo,
  SafeguardMobileInfo,
  SafeguardPdfData,
} from '../interfaces/safeguard-pdf-interfaces';

const ROW_HEIGHT = 18;

// El formato físico (ADM.F.00) siempre trae "Página: 1 de 2" impreso igual
// en ambas páginas — no es un contador dinámico, se replica tal cual.
const PAGE_LABEL = '1 de 1';
const REVISION_LABEL = '1';
const ELABORATED_LABEL = 'Julio de 2025';
const NEXT_REVISION_LABEL = 'Julio de 2028';

const LEGAL_TEXT =
  'He recibido de la empresa DIAGNÓSTICO Y REFERENCIA ANALÍTICA S.A. de C.V. el equipo de trabajo que se ' +
  'menciona en este documento. Este equipo se entrega en óptimas condiciones para un uso adecuado. Me ' +
  'comprometo a cuidarlo y mantenerlo en buen estado, siendo utilizado únicamente dentro del ámbito laboral. ' +
  'Al término de la relación laboral se deberá regresar cualquier equipo aquí mencionado al jefe directo y/o ' +
  'recursos humanos. En caso de pérdida o robo, correrán a mi cargo los costos de reparación o reposición.';

@Injectable()
export class SafeguardPdfRenderer {
  constructor(private readonly kit: PdfDrawingKit) {}

  render(doc: PDFKit.PDFDocument, data: SafeguardPdfData): void {
    const layout = this.kit.buildLayout(doc);

    let y = this.drawHeader(doc, layout, data);
    y = this.drawInfoGrid(doc, layout, y, data);

    if (data.computer) {
      y = this.drawComputerSection(doc, layout, y, data.computer);
    }
    if (data.mobile) {
      y = this.drawMobileSection(doc, layout, y, data.mobile);
    }

    this.kit.drawAcknowledgementFooter(doc, layout, y, LEGAL_TEXT, ELABORATED_LABEL, NEXT_REVISION_LABEL);
  }

  // ===========================
  // ENCABEZADO
  // ===========================
  private drawHeader(doc: PDFKit.PDFDocument, layout: PdfLayout, data: SafeguardPdfData): number {
    return this.kit.drawFormHeader(doc, layout, {
      logoPath: data.meta.logoPath,
      companyName: data.meta.companyName,
      subtitle: 'RESPONSIVA DE HERRAMIENTAS DE TRABAJO',
      docCode: data.meta.docCode,
      pageLabel: PAGE_LABEL,
      revisionLabel: REVISION_LABEL,
    });
  }

  // ===========================
  // GRILLA: datos del empleado + herramientas a asignar + uso
  // ===========================
  private drawInfoGrid(doc: PDFKit.PDFDocument, layout: PdfLayout, y: number, data: SafeguardPdfData): number {
    const { marginLeft, marginRight, pageWidth } = layout;
    const width = pageWidth - marginLeft - marginRight;

    const label1W = 130;
    const value1W = 226;
    const label2W = 60;
    const value2W = width - label1W - value1W - label2W;

    let cursor = y;

    cursor = this.kit.drawFourCellRow(doc, marginLeft, cursor, ROW_HEIGHT, [
      { width: label1W, text: 'Nombre de usuario:', fill: true, bold: true },
      { width: value1W, text: data.employee.employeeName },
      { width: label2W, text: 'Fecha:', fill: true, bold: true },
      { width: value2W, text: data.meta.formattedDate },
    ]);

    cursor = this.kit.drawFourCellRow(doc, marginLeft, cursor, ROW_HEIGHT, [
      { width: label1W, text: 'Puesto:', fill: true, bold: true },
      { width: value1W, text: data.employee.position },
      { width: label2W, text: 'Área:', fill: true, bold: true },
      { width: value2W, text: data.employee.area },
    ]);

    cursor = this.kit.drawToolsRow(doc, layout, cursor, [
      { label: 'Computadora', checked: Boolean(data.computer) },
      { label: 'Celular', checked: Boolean(data.mobile) },
    ]);

    cursor = this.kit.drawUsageRow(doc, layout, cursor, data.usage);

    return cursor + 10;
  }

  // ===========================
  // SECCIONES DE EQUIPO
  // ===========================
  private drawComputerSection(doc: PDFKit.PDFDocument, layout: PdfLayout, y: number, computer: SafeguardComputerInfo): number {
    let cursor = this.kit.drawSectionHeader(doc, layout, y, 'Equipo de cómputo');

    cursor = this.kit.drawTwoColumnRow(doc, layout, cursor, 'Marca', computer.brand, 'Modelo', computer.model);
    cursor = this.kit.drawTwoColumnRow(doc, layout, cursor, 'No. serie', computer.serialNumber, 'Código interno', computer.internalCode);
    cursor = this.kit.drawTwoColumnRow(doc, layout, cursor, 'Disco duro', computer.hardDrive, 'Procesador', computer.processor);
    cursor = this.kit.drawFullRow(doc, layout, cursor, 'Accesorios incluidos', computer.accessories);
    cursor = this.kit.drawConditionRow(doc, layout, cursor, computer.conditionLabel);
    cursor = this.kit.drawFullRow(doc, layout, cursor, 'Observaciones', computer.observations);

    return cursor + 10;
  }

  private drawMobileSection(doc: PDFKit.PDFDocument, layout: PdfLayout, y: number, mobile: SafeguardMobileInfo): number {
    let cursor = this.kit.drawSectionHeader(doc, layout, y, 'Equipo celular');

    cursor = this.kit.drawTwoColumnRow(doc, layout, cursor, 'Marca', mobile.brand, 'Modelo', mobile.model);
    cursor = this.kit.drawTwoColumnRow(doc, layout, cursor, 'IMEI', mobile.imei, 'Número', mobile.phoneNumber);
    cursor = this.kit.drawFullRow(doc, layout, cursor, 'Accesorios incluidos', mobile.accessories);
    cursor = this.kit.drawConditionRow(doc, layout, cursor, mobile.conditionLabel);
    cursor = this.kit.drawFullRow(doc, layout, cursor, 'Observaciones', mobile.observations);

    return cursor + 10;
  }
}
