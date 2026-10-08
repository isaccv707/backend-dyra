import type {
  ReferenceValueAgeUnit,
  ReferenceValueGender,
  StudyAgeFormat,
  StudyGender,
} from '../constants/study-fields.const';

export class Study {
  id?: string;
  name!: string;
  slug!: string;
  code!: string;
  description?: string;
  sampleTypeId?: number | null;
  deliveryTime?: number;
  preparation?: string;
  isActive?: boolean;
  abbreviation?: string;
  sectionId?: number | null;
  techniqueId?: number | null;
  isPanel!: boolean;
  units?: string | null;
  decimals?: number | null;
  gender!: StudyGender;
  ageFormat!: StudyAgeFormat;
  minAge!: number;
  maxAge!: number;
  priceSheets?: StudyOnPriceSheet[];
  referenceValues?: ReferenceValue[];
}

export class ReferenceValue {
  id?: string;
  order!: number;
  studyId?: string;
  gender?: ReferenceValueGender | null;
  unitAge?: ReferenceValueAgeUnit | null;
  minAge?: number | null;
  maxAge?: number | null;
  minValue?: number | null;
  maxValue?: number | null;
  text?: string | null;
  date!: Date;
}

export class StudyOnPriceSheet {
  id?: string;
  price!: number;
  showPrice!: boolean;
  priceSheetId!: string;
  studyId?: string;
}
