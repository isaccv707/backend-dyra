export interface SafeguardMeta {
  formattedDate: string;
  docCode: string;
  companyName: string;
  logoPath: string | null;
}

export interface SafeguardEmployeeInfo {
  employeeName: string;
  position: string;
  area: string;
}

export interface SafeguardUsageInfo {
  usageType: 'TEMPORARY' | 'PERMANENT';
  usageLabel: string;
  formattedStartDate: string | null;
  formattedEndDate: string | null;
}

export interface SafeguardComputerInfo {
  brand: string;
  model: string;
  serialNumber: string;
  internalCode: string;
  hardDrive: string;
  processor: string;
  accessories: string;
  conditionLabel: string;
  observations: string;
}

export interface SafeguardMobileInfo {
  brand: string;
  model: string;
  imei: string;
  phoneNumber: string;
  accessories: string;
  conditionLabel: string;
  observations: string;
}

export interface VehicleInspectionRow {
  label: string;
  state: string;
  observations: string;
}

export interface SafeguardVehicleInfo {
  brand: string;
  model: string;
  mileage: string;
  plateNumber: string;
  fuelType: string;
  transmission: string;
  conditionLabel: string;
  revisionRows: VehicleInspectionRow[];
  inspectionRows: VehicleInspectionRow[];
}

export interface SafeguardPdfData {
  meta: SafeguardMeta;
  employee: SafeguardEmployeeInfo;
  usage: SafeguardUsageInfo;
  computer?: SafeguardComputerInfo;
  mobile?: SafeguardMobileInfo;
  vehicle?: SafeguardVehicleInfo;
}
