import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

@Module({
  controllers: [RolesController, PermissionsController],
  providers: [RolesService, PermissionsService],
})
export class RolesPermissionsModule {}
