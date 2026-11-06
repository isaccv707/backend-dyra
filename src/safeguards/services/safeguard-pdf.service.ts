import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { SafeguardConditionState, SafeguardUsageType } from '@prisma/client';
import { SafeguardPdfData } from '../interfaces/safeguard-pdf-interfaces';
import { SafeguardPdfRenderer } from '../pdf/safeguard-pdf.renderer';
import { SafeguardWithDetails } from '../types/safeguard.types';

const DOC_CODE = 'ADM.F.18';
const COMPANY_NAME = 'Diagnóstico y Referencia Analítica S.A. DE C.V.';

/** Maps a safeguard to the ADM.F.18 PDF data and renders it. */
@Injectable()
export class SafeguardPdfService {
  constructor(private readonly pdfRenderer: SafeguardPdfRenderer) {}

  buildSafeguardPdf(
    doc: PDFKit.PDFDocument,
    safeguard: SafeguardWithDetails,
  ): void {
    const data = this.buildPdfData(safeguard);
    this.pdfRenderer.render(doc, data);
  }

  private buildPdfData(safeguard: SafeguardWithDetails): SafeguardPdfData {
    return {
      meta: {
        formattedDate: safeguard.createdAt.toLocaleDateString('es-MX'),
        docCode: DOC_CODE,
        companyName: COMPANY_NAME,
        logoPath: this.resolveLogoPath(),
      },
      employee: {
        employeeName: safeguard.employeeName,
        position: safeguard.position ?? '',
        area: safeguard.area,
      },
      usage: {
        usageType: safeguard.usageType,
        usageLabel:
          safeguard.usageType === SafeguardUsageType.TEMPORARY
            ? 'Temporal'
            : 'Permanente',
        formattedStartDate: safeguard.startDate
          ? safeguard.startDate.toLocaleDateString('es-MX')
          : null,
        formattedEndDate: safeguard.endDate
          ? safeguard.endDate.toLocaleDateString('es-MX')
          : null,
      },
      computer: safeguard.computer
        ? {
            brand: safeguard.computer.brand,
            model: safeguard.computer.model,
            serialNumber: safeguard.computer.serialNumber ?? '',
            internalCode: safeguard.computer.internalCode ?? '',
            hardDrive: safeguard.computer.hardDrive ?? '',
            processor: safeguard.computer.processor ?? '',
            accessories: this.composeAccessoriesLabel(
              safeguard.computer.accessoryDetails,
            ),
            conditionLabel: this.conditionLabel(safeguard.computer.condition),
            observations: safeguard.computer.observations ?? '',
          }
        : undefined,
      mobile: safeguard.mobile
        ? {
            brand: safeguard.mobile.brand,
            model: safeguard.mobile.model,
            serialNumber: safeguard.mobile.serialNumber ?? '',
            internalCode: safeguard.mobile.internalCode ?? '',
            imei: safeguard.mobile.imei ?? '',
            phoneNumber: safeguard.mobile.phoneNumber ?? '',
            accessories: this.composeAccessoriesLabel(
              safeguard.mobile.accessoryDetails,
            ),
            conditionLabel: this.conditionLabel(safeguard.mobile.condition),
            observations: safeguard.mobile.observations ?? '',
          }
        : undefined,
    };
  }

  private composeAccessoriesLabel(
    accessoryDetails: {
      name: string;
      serialNumber: string | null;
      internalCode: string | null;
    }[],
  ): string {
    if (!accessoryDetails.length) return '';

    return accessoryDetails
      .map((a) => {
        const codes = [
          a.serialNumber && `S/N ${a.serialNumber}`,
          a.internalCode,
        ].filter(Boolean);
        return codes.length ? `${a.name} (${codes.join(' — ')})` : a.name;
      })
      .join('; ');
  }

  private conditionLabel(condition: SafeguardConditionState): string {
    return condition === SafeguardConditionState.NEW ? 'Nuevo' : 'Seminuevo';
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
      'No se pudo cargar el logo para el PDF de resguardo. Ninguna ruta encontrada:',
      candidatePaths,
    );

    return null;
  }
}
