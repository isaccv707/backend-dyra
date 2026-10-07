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

@Module({
  controllers: [
    StudySectionsController,
    SampleTypesController,
    StudyTechniquesController,
  ],
  providers: [StudySectionsService, SampleTypesService, StudyTechniquesService],
})
export class StudyCatalogsModule {}
