import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { SafeguardConditionState } from '@prisma/client';
import {
  getVehicleInspectionItemLabel,
  VEHICLE_BODY_INSPECTION_ITEMS,
  VEHICLE_REVISION_ITEMS,
} from '../constants/vehicle-inspection-items.const';
import { VehicleSafeguardPdfData } from '../interfaces/vehicle-safeguard-pdf-interfaces';
import { VehicleSafeguardPdfRenderer } from '../pdf/vehicle-safeguard-pdf.renderer';
import { VehicleSafeguardWithDetails } from '../types/vehicle-safeguard.types';

const DOC_CODE = 'ADM.F.01';
const COMPANY_NAME = 'Diagnóstico y Referencia Analítica S.A. DE C.V.';

/** Maps a vehicle safeguard to the ADM.F.01 PDF data and renders it. */
@Injectable()
export class VehicleSafeguardPdfService {
  constructor(private readonly pdfRenderer: VehicleSafeguardPdfRenderer) {}

  buildSafeguardPdf(
    doc: PDFKit.PDFDocument,
    safeguard: VehicleSafeguardWithDetails,
  ): void {
    const data = this.buildPdfData(safeguard);
    this.pdfRenderer.render(doc, data);
  }

  private buildPdfData(
    safeguard: VehicleSafeguardWithDetails,
  ): VehicleSafeguardPdfData {
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
        formattedStartDate: safeguard.startDate
          ? safeguard.startDate.toLocaleDateString('es-MX')
          : null,
        formattedEndDate: safeguard.endDate
          ? safeguard.endDate.toLocaleDateString('es-MX')
          : null,
      },
      vehicle: {
        brand: safeguard.brand,
        model: safeguard.model,
        mileage: safeguard.mileage ?? '',
        plateNumber: safeguard.plateNumber ?? '',
        fuelType: safeguard.fuelType ?? '',
        transmission: safeguard.transmission ?? '',
        conditionLabel: this.conditionLabel(safeguard.condition),
        revisionRows: this.buildInspectionRows(
          VEHICLE_REVISION_ITEMS,
          safeguard.inspectionItems,
        ),
        inspectionRows: this.buildInspectionRows(
          VEHICLE_BODY_INSPECTION_ITEMS,
          safeguard.inspectionItems,
        ),
      },
    };
  }

  private buildInspectionRows(
    canonicalItems: { key: string; label: string }[],
    submitted: {
      itemKey: string;
      state: string | null;
      observations: string | null;
    }[],
  ) {
    const byKey = new Map(submitted.map((item) => [item.itemKey, item]));

    return canonicalItems.map(({ key, label }) => {
      const found = byKey.get(key);
      return {
        label: label ?? getVehicleInspectionItemLabel(key),
        state: found?.state ?? '',
        observations: found?.observations ?? '',
      };
    });
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
      'No se pudo cargar el logo para el PDF de resguardo de vehículo. Ninguna ruta encontrada:',
      candidatePaths,
    );

    return null;
  }
}
