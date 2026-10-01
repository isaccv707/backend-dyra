// Los tres catálogos de estudio (sección, tipo de muestra, técnica) comparten
// shape y reglas; esto describe lo único que cambia entre ellos.
export type StudyCatalogKind = 'section' | 'sampleType' | 'technique';

export interface StudyCatalogConfig {
  kind: StudyCatalogKind;
  // FK en Study que apunta a este catálogo
  studyField: 'sectionId' | 'sampleTypeId' | 'techniqueId';
  entityName: string; // para mensajes de error en inglés (handleDatabaseErrors)
  label: string; // para mensajes de negocio en español
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
