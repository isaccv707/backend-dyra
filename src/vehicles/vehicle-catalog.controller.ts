import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { VehicleCatalogService } from './vehicle-catalog.service';
import { CreateVehicleCatalogDto } from './dto/create-vehicle-catalog.dto';
import { UpdateVehicleCatalogDto } from './dto/update-vehicle-catalog.dto';
import { FindVehicleCatalogDto } from './dto/find-vehicle-catalog.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@ApiTags('vehicle-catalog')
@Controller('vehicle-catalog')
export class VehicleCatalogController {
  constructor(private readonly vehicleCatalogService: VehicleCatalogService) {}

  @ApiOperation({ summary: 'Crear modelo de catálogo de vehículo', description: 'Crea un nuevo modelo de vehículo en el catálogo (no está ligado a una sucursal).' })
  @ApiResponse({ status: 201, description: 'Modelo de catálogo creado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('vehicle-catalog:create')
  @Post()
  create(@Body() createVehicleCatalogDto: CreateVehicleCatalogDto) {
    return this.vehicleCatalogService.create(createVehicleCatalogDto);
  }

  @ApiOperation({ summary: 'Listar catálogo de vehículos', description: 'Devuelve los modelos de vehículo disponibles en el catálogo. Por defecto omite los archivados (isActive=false); use includeInactive=true para incluirlos.' })
  @ApiResponse({ status: 200, description: 'Listado de modelos de catálogo.' })
  @Public()
  @Get()
  findAll(@Query() dto: FindVehicleCatalogDto) {
    return this.vehicleCatalogService.findAll(dto);
  }

  @ApiOperation({ summary: 'Obtener modelo de catálogo de vehículo', description: 'Devuelve un modelo de catálogo por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador del modelo de catálogo.' })
  @ApiResponse({ status: 200, description: 'Modelo de catálogo encontrado.' })
  @ApiResponse({ status: 404, description: 'Modelo de catálogo no encontrado.' })
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vehicleCatalogService.findOne(id);
  }

  @ApiOperation({ summary: 'Actualizar modelo de catálogo de vehículo', description: 'Actualiza los datos de un modelo de catálogo existente.' })
  @ApiParam({ name: 'id', description: 'Identificador del modelo de catálogo.' })
  @ApiResponse({ status: 200, description: 'Modelo de catálogo actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Modelo de catálogo no encontrado.' })
  @ApiBearerAuth()
  @Permissions('vehicle-catalog:update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateVehicleCatalogDto: UpdateVehicleCatalogDto) {
    return this.vehicleCatalogService.update(id, updateVehicleCatalogDto);
  }

  @ApiOperation({ summary: 'Eliminar modelo de catálogo de vehículo', description: 'Elimina un modelo de catálogo. Falla si existen vehículos dados de alta con ese modelo; en ese caso, archívelo (PATCH con isActive: false) en vez de eliminarlo.' })
  @ApiParam({ name: 'id', description: 'Identificador del modelo de catálogo.' })
  @ApiResponse({ status: 200, description: 'Modelo de catálogo eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Modelo de catálogo no encontrado.' })
  @ApiBearerAuth()
  @Permissions('vehicle-catalog:delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.vehicleCatalogService.remove(id);
  }
}
