import { Module } from '@nestjs/common';
import {
  SampleTypesController,
  StudySectionsController,
  StudyTechniquesController,
} from './study-catalog.controller';
import {
  SampleTypesService,
  StudySectionsService,
  StudyTechniquesService,
} from './study-catalog.service';
import { StudyCatalogImportController } from './study-catalog-import.controller';
import { StudyCatalogImportService } from './study-catalog-import.service';

@Module({
  controllers: [
    StudySectionsController,
    SampleTypesController,
    StudyTechniquesController,
    StudyCatalogImportController,
  ],
  providers: [
    StudySectionsService,
    SampleTypesService,
    StudyTechniquesService,
    StudyCatalogImportService,
  ],
})
export class StudyCatalogsModule {}
