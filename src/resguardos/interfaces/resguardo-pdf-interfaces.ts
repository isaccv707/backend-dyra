export interface ResguardoMeta {
  formattedDate: string;
  docCode: string;
  companyName: string;
  logoPath: string | null;
}

export interface ResguardoEmployeeInfo {
  employeeName: string;
  position: string;
  area: string;
}

export interface ResguardoUsageInfo {
  usageType: 'TEMPORARY' | 'PERMANENT';
  usageLabel: string;
  formattedStartDate: string | null;
  formattedEndDate: string | null;
}

export interface ResguardoComputerInfo {
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

export interface ResguardoMobileInfo {
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

export interface ResguardoVehicleInfo {
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

export interface ResguardoPdfData {
  meta: ResguardoMeta;
  employee: ResguardoEmployeeInfo;
  usage: ResguardoUsageInfo;
  computer?: ResguardoComputerInfo;
  mobile?: ResguardoMobileInfo;
  vehicle?: ResguardoVehicleInfo;
}
