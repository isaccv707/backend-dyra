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
  studyPrices?: StudyPrice[];
}

export class StudyPrice {
  id?: string;
  price!: number;
  showPrice!: boolean;
  stateId!: number;
  studyId?: string;
}
