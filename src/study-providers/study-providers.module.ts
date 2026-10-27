import { Module } from '@nestjs/common';
import { StudyProvidersController } from './study-providers.controller';
import { StudyProvidersService } from './study-providers.service';

@Module({
  controllers: [StudyProvidersController],
  providers: [StudyProvidersService],
})
export class StudyProvidersModule {}
