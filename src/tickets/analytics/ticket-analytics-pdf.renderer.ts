import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from '../tickets.service';
import {
  TicketAnalyticsSummary,
  TicketsByCategoryRow,
  TicketsByUserRow,
} from './tickets-analytics.types';

interface ReportMeta {
  logoPath: string | null;
  filtersLabel: string | null;
}

interface ReportData {
  summary: TicketAnalyticsSummary;
  byCategory: TicketsByCategoryRow[];
  byUser: TicketsByUserRow[];
  meta: ReportMeta;
}

interface TableColumn {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

// Paleta institucional DYRA — mismo verde que ya usan los formatos de
// resguardo (PdfDrawingKit.SECTION_HEADER_COLOR), para que todos los PDFs
// del sistema se sientan de la misma familia visual.
const BRAND_GREEN = '#8DC63F';
const BRAND_GREEN_DARK = '#5B9B23';
const TEXT_DARK = '#1F2937';
const TEXT_MUTED = '#6B7280';
const BORDER_COLOR = '#E2E5DD';
const ZEBRA_FILL = '#F4F7F0';
const CARD_BG = '#F8FAF5';

const MARGIN = 45;
const COMPANY_NAME = 'DYRA Analítica';
const ROW_HEIGHT = 20;
// Banda reservada al pie de página. pdfkit pagina automáticamente en
// cuanto un doc.text() cae más allá de pageHeight - marginBottom, así que
// TODO el contenido (incluido el propio footer) debe quedar dentro de ese
// límite — nunca por debajo — o cada línea de texto del footer dispara un
// salto de página fantasma.
const FOOTER_HEIGHT = 30;

@Injectable()
export class TicketAnalyticsPdfRenderer {
  renderToBuffer(data: ReportData): Promise<Buffer> {
    const doc = new PDFDocument({ margin: MARGIN, size: 'LETTER' });
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      let page = 1;
      this.drawFooter(doc, page);
      doc.on('pageAdded', () => {
        page += 1;
        this.drawFooter(doc, page);
      });

      const headerBottom = this.drawHeader(doc, data.meta);
      doc.y = headerBottom;

      this.drawKpiCards(doc, data.summary);
      this.drawStatusAndPriority(doc, data.summary);
      this.drawByCategory(doc, data.byCategory);
      this.drawByUser(doc, data.byUser);

      doc.end();
    });
  }

  // ===========================
  // ENCABEZADO
  // ===========================
  private drawHeader(doc: PDFKit.PDFDocument, meta: ReportMeta): number {
    const { marginLeft: x, pageWidth, marginRight } = this.layout(doc);
    const topY = doc.page.margins.top;
    const logoWidth = 42;
    const textX = meta.logoPath ? x + logoWidth + 14 : x;

    if (meta.logoPath) {
      try {
        doc.image(meta.logoPath, x, topY - 2, {
          fit: [logoWidth, 52],
        });
      } catch (error) {
        console.warn('Error al cargar el logo para el PDF:', error);
      }
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor(TEXT_DARK)
      .text(COMPANY_NAME, textX, topY);
    doc
      .font('Helvetica')
      .fontSize(12)
      .fillColor(BRAND_GREEN_DARK)
      .text('Reporte de tickets', textX, topY + 22);

    const generatedLabel = `Generado el ${new Date().toLocaleString('es-MX')}`;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(TEXT_MUTED)
      .text(generatedLabel, x, topY, {
        width: pageWidth - marginRight - x,
        align: 'right',
      });

    let bottomY = topY + 44;
    if (meta.filtersLabel) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor(TEXT_MUTED)
        .text(meta.filtersLabel, textX, bottomY, {
          width: pageWidth - marginRight - textX,
        });
      bottomY = doc.y + 4;
    }

    bottomY = Math.max(bottomY, topY + 58) + 6;
    doc.rect(x, bottomY, pageWidth - marginRight - x, 3).fill(BRAND_GREEN);

    return bottomY + 18;
  }

  // ===========================
  // TARJETAS DE KPI
  // ===========================
  private drawKpiCards(
    doc: PDFKit.PDFDocument,
    summary: TicketAnalyticsSummary,
  ): void {
    const { marginLeft: x, pageWidth, marginRight } = this.layout(doc);
    const width = pageWidth - marginRight - x;
    const gap = 10;
    const cardWidth = (width - gap * 3) / 4;
    const cardHeight = 54;
    const y = doc.y;

    const cards: [string, string][] = [
      ['Total de tickets', String(summary.total)],
      ['Prom. resolución', this.formatHours(summary.avgResolutionSeconds)],
      [
        'Tasa de reapertura',
        `${Math.round(summary.reopenedRate * 1000) / 10}%`,
      ],
      ['Vencidos (SLA)', String(summary.overdueCount)],
    ];

    cards.forEach(([label, value], i) => {
      const cardX = x + i * (cardWidth + gap);

      doc.rect(cardX, y, cardWidth, cardHeight).fill(CARD_BG);
      doc.rect(cardX, y, cardWidth, 3).fill(BRAND_GREEN);
      doc
        .rect(cardX, y, cardWidth, cardHeight)
        .strokeColor(BORDER_COLOR)
        .lineWidth(0.7)
        .stroke();

      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor(TEXT_DARK)
        .text(value, cardX + 8, y + 14, { width: cardWidth - 16 });
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(TEXT_MUTED)
        .text(label, cardX + 8, y + 38, { width: cardWidth - 16 });
    });

    doc.y = y + cardHeight + 22;
  }

  // ===========================
  // POR ESTADO / POR PRIORIDAD (lado a lado)
  // ===========================
  private drawStatusAndPriority(
    doc: PDFKit.PDFDocument,
    summary: TicketAnalyticsSummary,
  ): void {
    const { marginLeft: x, pageWidth, marginRight } = this.layout(doc);
    const width = pageWidth - marginRight - x;
    const colWidth = (width - 20) / 2;
    const startY = doc.y;

    this.drawSectionTitle(doc, 'Por estado', x, startY);
    this.drawSectionTitle(doc, 'Por prioridad', x + colWidth + 20, startY);

    const tableY = startY + 20;

    const statusBottom = this.drawTable(
      doc,
      x,
      tableY,
      [
        { header: 'Estado', width: colWidth * 0.65 },
        { header: 'Tickets', width: colWidth * 0.35, align: 'right' },
      ],
      summary.byStatus.map((s) => [
        TICKET_STATUS_LABELS[s.status],
        String(s.count),
      ]),
    );

    const priorityBottom = this.drawTable(
      doc,
      x + colWidth + 20,
      tableY,
      [
        { header: 'Prioridad', width: colWidth * 0.65 },
        { header: 'Tickets', width: colWidth * 0.35, align: 'right' },
      ],
      summary.byPriority.map((p) => [
        TICKET_PRIORITY_LABELS[p.priority],
        String(p.count),
      ]),
    );

    doc.y = Math.max(statusBottom, priorityBottom) + 22;
  }

  // ===========================
  // POR CATEGORÍA Y SUBCATEGORÍA
  // ===========================
  private drawByCategory(
    doc: PDFKit.PDFDocument,
    byCategory: TicketsByCategoryRow[],
  ): void {
    const { marginLeft: x } = this.layout(doc);
    this.drawSectionTitle(doc, 'Por categoría (qué se levanta más)', x, doc.y);
    doc.y += 20;

    const rows: string[][] = byCategory.flatMap((c) => [
      [
        CATEGORY_LABELS[c.category],
        String(c.count),
        `${Math.round(c.percentage * 1000) / 10}%`,
      ],
      ...c.subcategories.map((s) => [`      • ${s.name}`, String(s.count), '']),
    ]);

    if (rows.length === 0) {
      this.drawEmptyState(doc, 'Sin tickets en el rango seleccionado.');
      return;
    }

    const bottom = this.drawTable(
      doc,
      x,
      doc.y,
      [
        { header: 'Categoría / subcategoría', width: 300 },
        { header: 'Tickets', width: 90, align: 'right' },
        { header: '%', width: 90, align: 'right' },
      ],
      rows,
      {
        boldRowIndexes: new Set(
          this.cumulativeCategoryHeaderIndexes(byCategory),
        ),
      },
    );

    doc.y = bottom + 22;
  }

  private cumulativeCategoryHeaderIndexes(
    byCategory: TicketsByCategoryRow[],
  ): number[] {
    const indexes: number[] = [];
    let cursor = 0;
    for (const c of byCategory) {
      indexes.push(cursor);
      cursor += 1 + c.subcategories.length;
    }
    return indexes;
  }

  // ===========================
  // POR USUARIO
  // ===========================
  private drawByUser(
    doc: PDFKit.PDFDocument,
    byUser: TicketsByUserRow[],
  ): void {
    const { marginLeft: x } = this.layout(doc);
    this.drawSectionTitle(doc, 'Por usuario (quién reporta más)', x, doc.y);
    doc.y += 20;

    if (byUser.length === 0) {
      this.drawEmptyState(doc, 'Sin tickets en el rango seleccionado.');
      return;
    }

    this.drawTable(
      doc,
      x,
      doc.y,
      [
        { header: 'Usuario', width: 220 },
        { header: 'Correo', width: 170 },
        { header: 'Total', width: 45, align: 'right' },
        { header: 'Prom. resolución', width: 95, align: 'right' },
      ],
      byUser.map((u) => [
        u.name,
        u.email ?? '',
        String(u.total),
        this.formatHours(u.avgResolutionSeconds),
      ]),
    );
  }

  // ===========================
  // PRIMITIVAS
  // ===========================
  private drawSectionTitle(
    doc: PDFKit.PDFDocument,
    title: string,
    x: number,
    y: number,
  ): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(TEXT_DARK)
      .text(title, x, y);
  }

  private drawEmptyState(doc: PDFKit.PDFDocument, text: string): void {
    const { marginLeft: x } = this.layout(doc);
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor(TEXT_MUTED)
      .text(text, x, doc.y);
    doc.y += 20;
  }

  // Tabla genérica con encabezado en verde institucional y zebra-striping,
  // reutilizada por las 4 secciones tabulares del reporte. Repite el
  // encabezado al saltar de página.
  private drawTable(
    doc: PDFKit.PDFDocument,
    x: number,
    startY: number,
    columns: TableColumn[],
    rows: string[][],
    opts?: { boldRowIndexes?: Set<number> },
  ): number {
    const { pageHeight, marginBottom } = this.layout(doc);
    const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
    let y = this.ensureSpace(doc, startY, ROW_HEIGHT * 2);

    const drawHeaderRow = (headerY: number) => {
      doc.rect(x, headerY, totalWidth, ROW_HEIGHT).fill(BRAND_GREEN);
      let colX = x;
      for (const col of columns) {
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#FFFFFF')
          .text(col.header, colX + 6, headerY + 6, {
            width: col.width - 10,
            align: col.align ?? 'left',
          });
        colX += col.width;
      }
      return headerY + ROW_HEIGHT;
    };

    // La tabla puede partirse en varias páginas — el borde de cada tramo se
    // dibuja al cerrarlo (page break o fin de filas), nunca calculado hacia
    // atrás desde el total de filas, porque eso da una altura incorrecta en
    // cuanto hay un salto de página de por medio.
    let segmentStartY = y;
    const closeSegment = (endY: number) => {
      doc
        .rect(x, segmentStartY, totalWidth, endY - segmentStartY)
        .strokeColor(BORDER_COLOR)
        .lineWidth(0.7)
        .stroke();
    };

    y = drawHeaderRow(y);

    rows.forEach((row, i) => {
      if (y + ROW_HEIGHT > pageHeight - marginBottom - FOOTER_HEIGHT) {
        closeSegment(y);
        doc.addPage();
        y = doc.page.margins.top;
        segmentStartY = y;
        y = drawHeaderRow(y);
      }

      if (i % 2 === 1) {
        doc.rect(x, y, totalWidth, ROW_HEIGHT).fill(ZEBRA_FILL);
      }

      const bold = opts?.boldRowIndexes?.has(i) ?? false;
      let colX = x;
      columns.forEach((col, colIndex) => {
        doc
          .font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(9)
          .fillColor(TEXT_DARK)
          .text(row[colIndex], colX + 6, y + 6, {
            width: col.width - 10,
            align: col.align ?? 'left',
            ellipsis: true,
          });
        colX += col.width;
      });

      y += ROW_HEIGHT;
    });

    closeSegment(y);
    return y;
  }

  private ensureSpace(
    doc: PDFKit.PDFDocument,
    y: number,
    needed: number,
  ): number {
    const { pageHeight, marginBottom } = this.layout(doc);
    if (y + needed > pageHeight - marginBottom - FOOTER_HEIGHT) {
      doc.addPage();
      return doc.page.margins.top;
    }
    return y;
  }

  private drawFooter(doc: PDFKit.PDFDocument, page: number): void {
    const {
      marginLeft: x,
      pageWidth,
      marginRight,
      pageHeight,
      marginBottom,
    } = this.layout(doc);
    // Debe quedar en o antes de pageHeight - marginBottom: pdfkit pagina
    // solo con que un doc.text() caiga más allá de ese límite (ver
    // FOOTER_HEIGHT), así que el footer vive pegado a ese borde, no en el
    // hueco en blanco debajo de él.
    const y = pageHeight - marginBottom - FOOTER_HEIGHT + 10;

    doc
      .moveTo(x, y)
      .lineTo(pageWidth - marginRight, y)
      .strokeColor(BORDER_COLOR)
      .lineWidth(0.7)
      .stroke();

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(TEXT_MUTED)
      .text('DYRA Analítica · Reporte de tickets', x, y + 6, {
        width: (pageWidth - marginRight - x) / 2,
      })
      .text(`Página ${page}`, x, y + 6, {
        width: pageWidth - marginRight - x,
        align: 'right',
      });
  }

  private layout(doc: PDFKit.PDFDocument) {
    return {
      pageWidth: doc.page.width,
      pageHeight: doc.page.height,
      marginLeft: doc.page.margins.left,
      marginRight: doc.page.margins.right,
      marginBottom: doc.page.margins.bottom,
    };
  }

  private formatHours(seconds: number | null): string {
    if (seconds === null || seconds === undefined) return 'N/D';
    const hours = Math.round((seconds / 3600) * 10) / 10;
    return `${hours} h`;
  }
}
