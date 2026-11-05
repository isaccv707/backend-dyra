import { StudyImportPanelsService } from './study-import-panels.service';
import { StudyImportParserService } from './study-import-parser.service';
import { StudyImportRulesService } from './study-import-rules.service';
import { StudyImportTemplateService } from './study-import-template.service';
import { StudyImportWriterService } from './study-import-writer.service';

/** Sub-services of StudyExcelImportService, for the module and its specs. */
export const STUDY_IMPORT_PROVIDERS = [
  StudyImportTemplateService,
  StudyImportParserService,
  StudyImportRulesService,
  StudyImportWriterService,
  StudyImportPanelsService,
];
