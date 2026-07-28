import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @ApiOperation({ summary: 'Crear rol', description: 'Crea un nuevo rol con su conjunto de permisos.' })
  @ApiResponse({ status: 201, description: 'Rol creado exitosamente.' })
  @Permissions('roles:create')
  @Post()
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.rolesService.create(createRoleDto);
  }

  @ApiOperation({ summary: 'Listar roles', description: 'Devuelve todos los roles del sistema.' })
  @ApiResponse({ status: 200, description: 'Listado de roles.' })
  @Permissions('roles:read')
  @Get()
  findAll() {
    return this.rolesService.findAll();
  }

  @ApiOperation({ summary: 'Obtener rol', description: 'Devuelve un rol por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador del rol.' })
  @ApiResponse({ status: 200, description: 'Rol encontrado.' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado.' })
  @Permissions('roles:read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }

  @ApiOperation({ summary: 'Actualizar rol', description: 'Actualiza los datos y permisos de un rol existente.' })
  @ApiParam({ name: 'id', description: 'Identificador del rol.' })
  @ApiResponse({ status: 200, description: 'Rol actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado.' })
  @Permissions('roles:update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    return this.rolesService.update(id, updateRoleDto);
  }

  @ApiOperation({ summary: 'Eliminar rol', description: 'Elimina un rol existente.' })
  @ApiParam({ name: 'id', description: 'Identificador del rol.' })
  @ApiResponse({ status: 200, description: 'Rol eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado.' })
  @Permissions('roles:delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.rolesService.remove(id);
  }
}
