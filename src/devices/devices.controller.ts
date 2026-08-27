import { Controller, Get, Post, Body, Patch, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import { CreateDeviceItemDto } from './dto/create-device-item.dto';
import { UpdateDeviceItemDto } from './dto/update-device-item.dto';
import { FindDevicesDto } from './dto/find-devices.dto';
import { FindMovementHistoryDto } from './dto/find-movement-history.dto';
import { AssignDeviceDto } from './dto/assign-device.dto';
import { RetireDeviceDto } from './dto/retire-device.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @ApiOperation({ summary: 'Dar de alta un equipo', description: 'Registra un nuevo equipo de hardware en el inventario de una sucursal.' })
  @ApiResponse({ status: 201, description: 'Equipo creado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('devices:create')
  @Post()
  create(
    @Body() createDeviceItemDto: CreateDeviceItemDto,
    @CurrentUser() user: BranchScopedUser & { id: string },
  ) {
    return this.devicesService.create(createDeviceItemDto, user);
  }

  @ApiOperation({ summary: 'Listar equipos', description: 'Devuelve los equipos de inventario, con alcance según la sucursal del usuario autenticado.' })
  @ApiResponse({ status: 200, description: 'Listado de equipos.' })
  @ApiBearerAuth()
  @Permissions('devices:read')
  @Get()
  findAll(@Query() dto: FindDevicesDto, @CurrentUser() user: BranchScopedUser) {
    return this.devicesService.findAll(dto, user);
  }

  @ApiOperation({ summary: 'Obtener equipo', description: 'Devuelve un equipo por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador del equipo.' })
  @ApiResponse({ status: 200, description: 'Equipo encontrado.' })
  @ApiResponse({ status: 404, description: 'Equipo no encontrado.' })
  @ApiBearerAuth()
  @Permissions('devices:read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.devicesService.findOne(id);
  }

  @ApiOperation({ summary: 'Historial de movimientos', description: 'Devuelve el historial de movimientos de un equipo (altas, asignaciones, traspasos, bajas).' })
  @ApiParam({ name: 'id', description: 'Identificador del equipo.' })
  @ApiResponse({ status: 200, description: 'Historial de movimientos del equipo.' })
  @ApiBearerAuth()
  @Permissions('devices:read')
  @Get(':id/movement-history')
  findMovementHistory(@Param('id') id: string, @Query() dto: FindMovementHistoryDto) {
    return this.devicesService.findMovementHistory(id, dto);
  }

  @ApiOperation({ summary: 'Actualizar equipo', description: 'Actualiza los datos de un equipo existente (no incluye asignación ni sucursal actual).' })
  @ApiParam({ name: 'id', description: 'Identificador del equipo.' })
  @ApiResponse({ status: 200, description: 'Equipo actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Equipo no encontrado.' })
  @ApiBearerAuth()
  @Permissions('devices:update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateDeviceItemDto: UpdateDeviceItemDto,
    @CurrentUser() user: BranchScopedUser & { id: string },
  ) {
    return this.devicesService.update(id, updateDeviceItemDto, user);
  }

  @ApiOperation({ summary: 'Asignar equipo', description: 'Asigna un equipo disponible a un empleado o a una ubicación (exclusivo, nunca ambos).' })
  @ApiParam({ name: 'id', description: 'Identificador del equipo.' })
  @ApiResponse({ status: 200, description: 'Equipo asignado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('devices:update')
  @Post(':id/assign')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignDeviceDto,
    @CurrentUser() user: BranchScopedUser & { id: string },
  ) {
    return this.devicesService.assign(id, dto, user);
  }

  @ApiOperation({ summary: 'Liberar equipo', description: 'Quita la asignación de un equipo (empleado o ubicación) y lo deja disponible.' })
  @ApiParam({ name: 'id', description: 'Identificador del equipo.' })
  @ApiResponse({ status: 200, description: 'Equipo liberado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('devices:update')
  @Post(':id/unassign')
  unassign(@Param('id') id: string, @CurrentUser() user: BranchScopedUser) {
    return this.devicesService.unassign(id, user);
  }

  @ApiOperation({
    summary: 'Desenlazar accesorio',
    description: 'Desenlaza un MONITOR/KEYBOARD/MOUSE de su computadora principal (mainDeviceId) sin darlo de baja; queda disponible.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del accesorio.' })
  @ApiResponse({ status: 200, description: 'Accesorio desenlazado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('devices:update')
  @Post(':id/unlink')
  unlink(@Param('id') id: string, @CurrentUser() user: BranchScopedUser & { id: string }) {
    return this.devicesService.unlink(id, user);
  }

  @ApiOperation({ summary: 'Dar de baja un equipo', description: 'Marca un equipo como retirado/dado de baja. No elimina el registro.' })
  @ApiParam({ name: 'id', description: 'Identificador del equipo.' })
  @ApiResponse({ status: 200, description: 'Equipo dado de baja exitosamente.' })
  @ApiBearerAuth()
  @Permissions('devices:update')
  @Post(':id/retire')
  retire(
    @Param('id') id: string,
    @Body() dto: RetireDeviceDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.devicesService.retire(id, dto, user);
  }
}
