import { Module } from '@nestjs/common';
import { ServicesService } from './services.service';
import { ServiceAdminQueryService } from './services/service-admin-query.service';
import { ServicePublicQueryService } from './services/service-public-query.service';
import { ServiceWriteService } from './services/service-write.service';
import { ServicesController } from './services.controller';
import { BranchesModule } from 'src/branches/branches.module';
import { CloudinaryModule } from 'src/common/cloudinary/cloudinary.module';

@Module({
  imports: [BranchesModule, CloudinaryModule],
  controllers: [ServicesController],
  providers: [
    ServicesService,
    ServiceWriteService,
    ServicePublicQueryService,
    ServiceAdminQueryService,
  ],
})
export class ServicesModule {}
