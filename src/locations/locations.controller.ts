import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { FindLocationsDto } from './dto/find-locations.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';

@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @ApiOperation({ summary: 'Crear ubicación', description: 'Crea un nuevo lugar físico (laboratorio, call center, etc.) dentro de una sucursal.' })
  @ApiResponse({ status: 201, description: 'Ubicación creada exitosamente.' })
  @ApiBearerAuth()
  @Permissions('locations:create')
  @Post()
  create(@Body() createLocationDto: CreateLocationDto, @CurrentUser() user: BranchScopedUser) {
    return this.locationsService.create(createLocationDto, user);
  }

  @ApiOperation({ summary: 'Listar ubicaciones', description: 'Devuelve las ubicaciones, con alcance según la sucursal del usuario autenticado.' })
  @ApiResponse({ status: 200, description: 'Listado de ubicaciones.' })
  @ApiBearerAuth()
  @Permissions('locations:read')
  @Get()
  findAll(@Query() dto: FindLocationsDto, @CurrentUser() user: BranchScopedUser) {
    return this.locationsService.findAll(dto, user);
  }

  @ApiOperation({ summary: 'Obtener ubicación', description: 'Devuelve una ubicación por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador de la ubicación.' })
  @ApiResponse({ status: 200, description: 'Ubicación encontrada.' })
  @ApiResponse({ status: 404, description: 'Ubicación no encontrada.' })
  @ApiBearerAuth()
  @Permissions('locations:read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.locationsService.findOne(id);
  }

  @ApiOperation({ summary: 'Actualizar ubicación', description: 'Actualiza los datos de una ubicación existente.' })
  @ApiParam({ name: 'id', description: 'Identificador de la ubicación.' })
  @ApiResponse({ status: 200, description: 'Ubicación actualizada exitosamente.' })
  @ApiResponse({ status: 404, description: 'Ubicación no encontrada.' })
  @ApiBearerAuth()
  @Permissions('locations:update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateLocationDto: UpdateLocationDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.locationsService.update(id, updateLocationDto, user);
  }

  @ApiOperation({ summary: 'Eliminar ubicación', description: 'Elimina una ubicación existente. Los equipos que tenía asignados quedan disponibles.' })
  @ApiParam({ name: 'id', description: 'Identificador de la ubicación.' })
  @ApiResponse({ status: 200, description: 'Ubicación eliminada exitosamente.' })
  @ApiResponse({ status: 404, description: 'Ubicación no encontrada.' })
  @ApiBearerAuth()
  @Permissions('locations:delete')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: BranchScopedUser) {
    return this.locationsService.remove(id, user);
  }
}
