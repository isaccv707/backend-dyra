export type ImportRowError = {
  row: number;
  code?: string;
  errors: string[];
};

/** A row that passed the file's own checks, ready to compare with the branch. */
export type ValidStudyImportRow = {
  row: number;
  code: string;
  name: string;
  title?: string;
  description?: string;
  sampleType?: string;
  preparation?: string;
  deliveryTime?: number;
  isActive?: boolean;
  serviceId: string;
  abbreviation?: string;
  section?: string;
  technique?: string;
  isPanel?: boolean;
  panelCodes?: string[];
  gender?: string;
  ageFormat?: string;
  minAge?: number;
  maxAge?: number;
  units?: string;
  decimals?: number;
};
