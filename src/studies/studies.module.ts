import { Module } from '@nestjs/common';
import { StudiesService } from './studies.service';
import { StudiesController } from './studies.controller';
import { StudyExcelImportService } from './study-excel-import.service';
import { STUDY_IMPORT_PROVIDERS } from './services/study-import.providers';
import { StudyExportService } from './services/study-export.service';
import { StudyPanelService } from './services/study-panel.service';
import { StudyPriceService } from './services/study-price.service';
import { StudyQueryService } from './services/study-query.service';
import { StudyValidationService } from './services/study-validation.service';
import { StudyWriteService } from './services/study-write.service';

@Module({
  controllers: [StudiesController],
  providers: [
    StudiesService,
    StudyExcelImportService,
    StudyValidationService,
    StudyWriteService,
    StudyQueryService,
    StudyPanelService,
    StudyPriceService,
    StudyExportService,
    ...STUDY_IMPORT_PROVIDERS,
  ],
  exports: [StudiesService, StudyExcelImportService],
})
export class StudiesModule {}
