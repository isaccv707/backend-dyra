import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Permissions('permissions:create')
  @Post()
  create(@Body() createPermissionDto: CreatePermissionDto) {
    return this.permissionsService.create(createPermissionDto);
  }

  @Permissions('permissions:read')
  @Get()
  findAll() {
    return this.permissionsService.findAll();
  }

  @Permissions('permissions:read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.permissionsService.findOne(id);
  }

  @Permissions('permissions:update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePermissionDto: UpdatePermissionDto) {
    return this.permissionsService.update(id, updatePermissionDto);
  }

  @Permissions('permissions:delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.permissionsService.remove(id);
  }
}
