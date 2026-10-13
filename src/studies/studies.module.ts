import { Module } from '@nestjs/common';
import { StudiesService } from './studies.service';
import { StudiesController } from './studies.controller';
import { StudyExcelImportService } from './study-excel-import.service';

@Module({
  controllers: [StudiesController],
  providers: [StudiesService, StudyExcelImportService],
  exports: [StudyExcelImportService],
})
export class StudiesModule {}
