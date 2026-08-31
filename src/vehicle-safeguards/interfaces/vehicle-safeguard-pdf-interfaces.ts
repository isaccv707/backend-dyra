import { PdfInspectionRow } from 'src/common/pdf/pdf-drawing.util';

export interface VehicleSafeguardMeta {
  formattedDate: string;
  docCode: string;
  companyName: string;
  logoPath: string | null;
}

export interface VehicleSafeguardEmployeeInfo {
  employeeName: string;
  position: string;
  area: string;
}

export interface VehicleSafeguardUsageInfo {
  usageType: 'TEMPORARY' | 'PERMANENT';
  formattedStartDate: string | null;
  formattedEndDate: string | null;
}

export interface VehicleSafeguardVehicleInfo {
  brand: string;
  model: string;
  mileage: string;
  plateNumber: string;
  fuelType: string;
  transmission: string;
  conditionLabel: string;
  revisionRows: PdfInspectionRow[];
  inspectionRows: PdfInspectionRow[];
}

export interface VehicleSafeguardPdfData {
  meta: VehicleSafeguardMeta;
  employee: VehicleSafeguardEmployeeInfo;
  usage: VehicleSafeguardUsageInfo;
  vehicle: VehicleSafeguardVehicleInfo;
}
