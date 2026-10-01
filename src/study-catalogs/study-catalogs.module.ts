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

// Catálogos de estudio por sucursal: secciones, tipos de muestra y técnicas.
@Module({
  controllers: [
    StudySectionsController,
    SampleTypesController,
    StudyTechniquesController,
  ],
  providers: [StudySectionsService, SampleTypesService, StudyTechniquesService],
})
export class StudyCatalogsModule {}
