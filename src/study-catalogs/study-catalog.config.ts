export type StudyCatalogKind = 'section' | 'sampleType' | 'technique';

export interface StudyCatalogConfig {
  kind: StudyCatalogKind;
  studyField: 'sectionId' | 'sampleTypeId' | 'techniqueId';
  entityName: string;
  label: string;
}

export const STUDY_CATALOGS: Record<StudyCatalogKind, StudyCatalogConfig> = {
  section: {
    kind: 'section',
    studyField: 'sectionId',
    entityName: 'Study section',
    label: 'la sección',
  },
  sampleType: {
    kind: 'sampleType',
    studyField: 'sampleTypeId',
    entityName: 'Sample type',
    label: 'el tipo de muestra',
  },
  technique: {
    kind: 'technique',
    studyField: 'techniqueId',
    entityName: 'Study technique',
    label: 'la técnica',
  },
};

export const STUDY_CATALOG_NAME_MAX_LENGTH = 150;
