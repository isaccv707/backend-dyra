import type {
  StudyAgeFormat,
  StudyGender,
} from '../constants/study-fields.const';

export class Study {
  id?: string;
  name!: string;
  slug!: string;
  code!: string;
  description?: string;
  sampleType?: string;
  deliveryTime?: number;
  preparation?: string;
  isActive?: boolean;
  abbreviation?: string;
  title?: string;
  section!: string;
  technique?: string;
  isPanel!: boolean;
  gender!: StudyGender;
  ageFormat!: StudyAgeFormat;
  minAge!: number;
  maxAge!: number;
  decimals!: number;
  priceSheets?: StudyOnPriceSheet[];
}

export class StudyOnPriceSheet {
  id?: string;
  price!: number;
  showPrice!: boolean;
  priceSheetId!: string;
  studyId?: string;
}
