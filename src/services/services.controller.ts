import { Controller, Get, Post, Body, Patch, Param, Delete, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { FindServicesDto } from './dto/find-services.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) { }

  @ApiOperation({ summary: 'Crear servicio', description: 'Crea un nuevo servicio de laboratorio.' })
  @ApiResponse({ status: 201, description: 'Servicio creado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('services:create')
  @Post()
  create(@Body() createServiceDto: CreateServiceDto) {
    return this.servicesService.create(createServiceDto);
  }

  @ApiOperation({ summary: 'Listar servicios', description: 'Devuelve los servicios disponibles, opcionalmente filtrados por sucursal.' })
  @ApiResponse({ status: 200, description: 'Listado de servicios.' })
  @Public()
  @Get()
  findAll(@Query() { branchId, priceSheetId }: FindServicesDto) {
    return this.servicesService.findAll(branchId, priceSheetId);
  }

  @ApiOperation({ summary: 'Obtener servicio', description: 'Devuelve un servicio por su identificador, opcionalmente filtrado por sucursal.' })
  @ApiParam({ name: 'id', description: 'Identificador del servicio.' })
  @ApiResponse({ status: 200, description: 'Servicio encontrado.' })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado.' })
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string, @Query() { branchId }: FindServicesDto) {
    return this.servicesService.findOne(id, branchId);
  }

  @ApiOperation({ summary: 'Actualizar servicio', description: 'Actualiza los datos de un servicio existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del servicio.' })
  @ApiResponse({ status: 200, description: 'Servicio actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado.' })
  @ApiBearerAuth()
  @Permissions('services:update')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateServiceDto: UpdateServiceDto) {
    return this.servicesService.update(id, updateServiceDto);
  }

  @ApiOperation({ summary: 'Eliminar servicio', description: 'Elimina un servicio existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del servicio.' })
  @ApiResponse({ status: 200, description: 'Servicio eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado.' })
  @ApiBearerAuth()
  @Permissions('services:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicesService.remove(id);
  }
}
