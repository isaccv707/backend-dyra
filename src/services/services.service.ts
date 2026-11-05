import { Injectable } from '@nestjs/common';
import { type BranchScopedUser } from 'src/common/utils/branch-access.util';
import { CreateServiceDto } from './dto/create-service.dto';
import {
  FindAdminServicesDto,
  FindAdminServiceStudiesDto,
} from './dto/find-admin-services.dto';
import { FindServicesDto } from './dto/find-services.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServiceAdminQueryService } from './services/service-admin-query.service';
import { ServicePublicQueryService } from './services/service-public-query.service';
import { ServiceWriteService } from './services/service-write.service';

/**
 * Entry point of the services domain for the controller. Holds no logic: each
 * operation lives in the sub-service of its responsibility.
 */
@Injectable()
export class ServicesService {
  constructor(
    private readonly write: ServiceWriteService,
    private readonly publicQuery: ServicePublicQueryService,
    private readonly adminQuery: ServiceAdminQueryService,
  ) {}

  create(createServiceDto: CreateServiceDto) {
    return this.write.create(createServiceDto);
  }

  update(id: string, updateServiceDto: UpdateServiceDto) {
    return this.write.update(id, updateServiceDto);
  }

  remove(id: string) {
    return this.write.remove(id);
  }

  findAll(dto: FindServicesDto) {
    return this.publicQuery.findAll(dto);
  }

  findOne(id: string, dto?: FindServicesDto) {
    return this.publicQuery.findOne(id, dto);
  }

  findAdminAll(dto: FindAdminServicesDto, user: BranchScopedUser) {
    return this.adminQuery.findAdminAll(dto, user);
  }

  findAdminOne(
    id: string,
    dto: FindAdminServiceStudiesDto,
    user: BranchScopedUser,
  ) {
    return this.adminQuery.findAdminOne(id, dto, user);
  }
}
