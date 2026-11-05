import { Prisma } from '@prisma/client';

export const STUDY_ALLOWED_FIELDS = [
  'name',
  'title',
  'code',
  'abbreviation',
  'section.name',
  'sampleType.name',
  'technique.name',
  'isActive',
  'isPanel',
  'units',
  'gender',
  'ageFormat',
  'minAge',
  'maxAge',
  'deliveryTime',
  'createdAt',
];

export const CATALOG_INCLUDE = {
  section: { select: { id: true, name: true } },
  sampleType: { select: { id: true, name: true } },
  technique: { select: { id: true, name: true } },
  // Admin only: public responses drop it with withoutProviderInfo().
  provider: { select: { id: true, name: true } },
} satisfies Prisma.StudyInclude;

export const REFERENCE_VALUES_INCLUDE = {
  orderBy: { order: 'asc' },
} satisfies Prisma.Study$referenceValuesArgs;

export const STUDY_WRITE_INCLUDE = {
  service: { select: { name: true, slug: true } },
  priceSheets: true,
  referenceValues: REFERENCE_VALUES_INCLUDE,
  ...CATALOG_INCLUDE,
} satisfies Prisma.StudyInclude;

export const PANEL_ITEMS_INCLUDE = {
  orderBy: { order: 'asc' },
  select: {
    order: true,
    child: {
      select: {
        id: true,
        code: true,
        name: true,
        title: true,
        abbreviation: true,
        isPanel: true,
      },
    },
  },
} satisfies Prisma.Study$panelItemsArgs;

export const STUDY_DETAIL_INCLUDE = {
  priceSheets: { include: { priceSheet: true } },
  service: true,
  ...CATALOG_INCLUDE,
  referenceValues: REFERENCE_VALUES_INCLUDE,
  panelItems: PANEL_ITEMS_INCLUDE,
  parentPanels: {
    select: {
      panel: { select: { id: true, code: true, name: true, title: true } },
    },
  },
} satisfies Prisma.StudyInclude;

// Public responses must never expose another sheet's prices (partner sheets
// are private): no priceSheets array, only the service's public sheet price.
export const STUDY_PUBLIC_DETAIL_INCLUDE = {
  service: { select: { id: true, name: true, slug: true, priceSheetId: true } },
  ...CATALOG_INCLUDE,
  referenceValues: REFERENCE_VALUES_INCLUDE,
  panelItems: PANEL_ITEMS_INCLUDE,
  parentPanels: STUDY_DETAIL_INCLUDE.parentPanels,
} satisfies Prisma.StudyInclude;

export const PUBLIC_PRICE_SHEET_WHERE = {
  isPublic: true,
  isActive: true,
} satisfies Prisma.PriceSheetsWhereInput;
