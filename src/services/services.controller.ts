import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { FindServicesDto } from './dto/find-services.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';
import {
  FindAdminServicesDto,
  FindAdminServiceStudiesDto,
} from './dto/find-admin-services.dto';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @ApiOperation({
    summary: 'Crear servicio',
    description: 'Crea un nuevo servicio de laboratorio.',
  })
  @ApiResponse({ status: 201, description: 'Servicio creado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('services:create')
  @Post()
  create(@Body() createServiceDto: CreateServiceDto) {
    return this.servicesService.create(createServiceDto);
  }

  @ApiOperation({
    summary: 'Listar servicios',
    description:
      "Devuelve los servicios disponibles, opcionalmente filtrados por sucursal. Con branchId, cada servicio trae solo los estudios con precio en su lista de precios (o en priceSheetId), que debe ser pública (isPublic) y activa, y se pueden filtrar con isPanel (true = solo perfiles, false = solo estudios individuales); priceInfo = { showPrice, price, message }, con message = 'Para mayor información consulte en sucursal' si showPrice = false.",
  })
  @ApiResponse({ status: 200, description: 'Listado de servicios.' })
  @ApiResponse({
    status: 404,
    description:
      'priceSheetId no existe, es de otra sucursal, no es pública o no está activa.',
  })
  @Public()
  @Get()
  findAll(@Query() dto: FindServicesDto) {
    return this.servicesService.findAll(dto);
  }

  @ApiOperation({
    summary: 'Listar servicios (admin)',
    description:
      'Servicios activos e inactivos (filtra con isActive) de las sucursales asignadas al usuario, con su lista de precios asignada (incluye isPublic/isActive). _count.studies es el total real de estudios del servicio (activos, inactivos, con o sin precio): si es > 0 el servicio no se puede eliminar.',
  })
  @ApiResponse({ status: 200, description: 'Listado de servicios.' })
  @ApiResponse({
    status: 403,
    description: 'branchId no está asignada al usuario.',
  })
  @ApiBearerAuth()
  @Permissions('services:read')
  @Get('admin')
  findAdminAll(
    @Query() dto: FindAdminServicesDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.servicesService.findAdminAll(dto, user);
  }

  @ApiOperation({
    summary: 'Obtener servicio (admin)',
    description:
      'Detalle de un servicio para el panel admin: priceSheet es la lista asignada aunque sea privada o inactiva (con isPublic/isActive), y studies trae paginados todos los estudios del servicio, con o sin precio (filtros search, isPanel, isActive). priceInfo = { showPrice, price, hasConfiguredPrice } según la lista asignada; price se devuelve aunque showPrice = false.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del servicio.' })
  @ApiResponse({ status: 200, description: 'Servicio encontrado.' })
  @ApiResponse({
    status: 403,
    description: 'El servicio es de una sucursal no asignada al usuario.',
  })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado.' })
  @ApiBearerAuth()
  @Permissions('services:read')
  @Get('admin/:id')
  findAdminOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() dto: FindAdminServiceStudiesDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.servicesService.findAdminOne(id, dto, user);
  }

  @ApiOperation({
    summary: 'Obtener servicio',
    description:
      'Devuelve un servicio por su identificador, opcionalmente filtrado por sucursal. Los estudios del servicio vienen paginados (usa page/limit) y se pueden filtrar por nombre o código con "search" y por tipo con "isPanel" (true = solo perfiles, false = solo estudios individuales; omitido = ambos). Solo incluye estudios con precio en la lista de precios del servicio; si esa lista no es pública (isPublic) o no está activa, priceSheet es null y studies llega vacío.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del servicio.' })
  @ApiResponse({ status: 200, description: 'Servicio encontrado.' })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado.' })
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string, @Query() dto: FindServicesDto) {
    return this.servicesService.findOne(id, dto);
  }

  @ApiOperation({
    summary: 'Actualizar servicio',
    description: 'Actualiza los datos de un servicio existente.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del servicio.' })
  @ApiResponse({
    status: 200,
    description: 'Servicio actualizado exitosamente.',
  })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado.' })
  @ApiBearerAuth()
  @Permissions('services:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServiceDto: UpdateServiceDto,
  ) {
    return this.servicesService.update(id, updateServiceDto);
  }

  @ApiOperation({
    summary: 'Eliminar servicio',
    description:
      'Elimina un servicio existente. Se rechaza (409) si tiene estudios asociados, activos o inactivos, con o sin precio.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del servicio.' })
  @ApiResponse({ status: 200, description: 'Servicio eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado.' })
  @ApiResponse({
    status: 409,
    description: 'El servicio tiene estudios asociados.',
  })
  @ApiBearerAuth()
  @Permissions('services:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicesService.remove(id);
  }
}
