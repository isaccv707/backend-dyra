import { Module } from '@nestjs/common';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { BranchesModule } from 'src/branches/branches.module';

@Module({
  imports: [BranchesModule],
  controllers: [ServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
