import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@ApiTags('permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @ApiOperation({ summary: 'Crear permiso', description: 'Crea un nuevo permiso del sistema de roles y permisos.' })
  @ApiResponse({ status: 201, description: 'Permiso creado exitosamente.' })
  @Permissions('permissions:create')
  @Post()
  create(@Body() createPermissionDto: CreatePermissionDto) {
    return this.permissionsService.create(createPermissionDto);
  }

  @ApiOperation({ summary: 'Listar permisos', description: 'Devuelve todos los permisos del sistema.' })
  @ApiResponse({ status: 200, description: 'Listado de permisos.' })
  @Permissions('permissions:read')
  @Get()
  findAll() {
    return this.permissionsService.findAll();
  }

  @ApiOperation({ summary: 'Obtener permiso', description: 'Devuelve un permiso por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador del permiso.' })
  @ApiResponse({ status: 200, description: 'Permiso encontrado.' })
  @ApiResponse({ status: 404, description: 'Permiso no encontrado.' })
  @Permissions('permissions:read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.permissionsService.findOne(id);
  }

  @ApiOperation({ summary: 'Actualizar permiso', description: 'Actualiza los datos de un permiso existente.' })
  @ApiParam({ name: 'id', description: 'Identificador del permiso.' })
  @ApiResponse({ status: 200, description: 'Permiso actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Permiso no encontrado.' })
  @Permissions('permissions:update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePermissionDto: UpdatePermissionDto) {
    return this.permissionsService.update(id, updatePermissionDto);
  }

  @ApiOperation({ summary: 'Eliminar permiso', description: 'Elimina un permiso existente.' })
  @ApiParam({ name: 'id', description: 'Identificador del permiso.' })
  @ApiResponse({ status: 200, description: 'Permiso eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Permiso no encontrado.' })
  @Permissions('permissions:delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.permissionsService.remove(id);
  }
}
