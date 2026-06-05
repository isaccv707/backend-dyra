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
  priceSheets?: StudyOnPriceSheet[];
}

export class StudyOnPriceSheet {
  id?: string;
  price!: number;
  showPrice!: boolean;
  priceSheetId!: string;
  studyId?: string;
}
