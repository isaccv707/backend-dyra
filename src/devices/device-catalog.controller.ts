import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DeviceCatalogService } from './device-catalog.service';
import { CreateDeviceCatalogDto } from './dto/create-device-catalog.dto';
import { UpdateDeviceCatalogDto } from './dto/update-device-catalog.dto';
import { FindDeviceCatalogDto } from './dto/find-device-catalog.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@ApiTags('device-catalog')
@Controller('device-catalog')
export class DeviceCatalogController {
  constructor(private readonly deviceCatalogService: DeviceCatalogService) {}

  @ApiOperation({ summary: 'Crear modelo de catálogo', description: 'Crea un nuevo modelo de equipo en el catálogo (no está ligado a una sucursal).' })
  @ApiResponse({ status: 201, description: 'Modelo de catálogo creado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('device-catalog:create')
  @Post()
  create(@Body() createDeviceCatalogDto: CreateDeviceCatalogDto) {
    return this.deviceCatalogService.create(createDeviceCatalogDto);
  }

  @ApiOperation({ summary: 'Listar catálogo', description: 'Devuelve los modelos de equipo disponibles en el catálogo. Por defecto omite los archivados (isActive=false); use includeInactive=true para incluirlos.' })
  @ApiResponse({ status: 200, description: 'Listado de modelos de catálogo.' })
  @Public()
  @Get()
  findAll(@Query() dto: FindDeviceCatalogDto) {
    return this.deviceCatalogService.findAll(dto);
  }

  @ApiOperation({ summary: 'Obtener modelo de catálogo', description: 'Devuelve un modelo de catálogo por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador del modelo de catálogo.' })
  @ApiResponse({ status: 200, description: 'Modelo de catálogo encontrado.' })
  @ApiResponse({ status: 404, description: 'Modelo de catálogo no encontrado.' })
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.deviceCatalogService.findOne(id);
  }

  @ApiOperation({ summary: 'Actualizar modelo de catálogo', description: 'Actualiza los datos de un modelo de catálogo existente.' })
  @ApiParam({ name: 'id', description: 'Identificador del modelo de catálogo.' })
  @ApiResponse({ status: 200, description: 'Modelo de catálogo actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Modelo de catálogo no encontrado.' })
  @ApiBearerAuth()
  @Permissions('device-catalog:update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDeviceCatalogDto: UpdateDeviceCatalogDto) {
    return this.deviceCatalogService.update(id, updateDeviceCatalogDto);
  }

  @ApiOperation({ summary: 'Eliminar modelo de catálogo', description: 'Elimina un modelo de catálogo. Falla si existen equipos dados de alta con ese modelo; en ese caso, archívelo (PATCH con isActive: false) en vez de eliminarlo.' })
  @ApiParam({ name: 'id', description: 'Identificador del modelo de catálogo.' })
  @ApiResponse({ status: 200, description: 'Modelo de catálogo eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Modelo de catálogo no encontrado.' })
  @ApiBearerAuth()
  @Permissions('device-catalog:delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.deviceCatalogService.remove(id);
  }
}
