import { Controller, Get, Post, Body, Patch, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleItemDto } from './dto/create-vehicle-item.dto';
import { UpdateVehicleItemDto } from './dto/update-vehicle-item.dto';
import { FindVehiclesDto } from './dto/find-vehicles.dto';
import { FindVehicleMovementHistoryDto } from './dto/find-vehicle-movement-history.dto';
import { AssignVehicleDto } from './dto/assign-vehicle.dto';
import { RetireVehicleDto } from './dto/retire-vehicle.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';

@ApiTags('vehicles')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @ApiOperation({ summary: 'Dar de alta un vehículo', description: 'Registra un nuevo vehículo en el inventario de una sucursal.' })
  @ApiResponse({ status: 201, description: 'Vehículo creado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('vehicles:create')
  @Post()
  create(
    @Body() createVehicleItemDto: CreateVehicleItemDto,
    @CurrentUser() user: BranchScopedUser & { id: string },
  ) {
    return this.vehiclesService.create(createVehicleItemDto, user);
  }

  @ApiOperation({ summary: 'Listar vehículos', description: 'Devuelve los vehículos de inventario, con alcance según la sucursal del usuario autenticado.' })
  @ApiResponse({ status: 200, description: 'Listado de vehículos.' })
  @ApiBearerAuth()
  @Permissions('vehicles:read')
  @Get()
  findAll(@Query() dto: FindVehiclesDto, @CurrentUser() user: BranchScopedUser) {
    return this.vehiclesService.findAll(dto, user);
  }

  @ApiOperation({ summary: 'Obtener vehículo', description: 'Devuelve un vehículo por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador del vehículo.' })
  @ApiResponse({ status: 200, description: 'Vehículo encontrado.' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado.' })
  @ApiBearerAuth()
  @Permissions('vehicles:read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vehiclesService.findOne(id);
  }

  @ApiOperation({ summary: 'Historial de movimientos', description: 'Devuelve el historial de movimientos de un vehículo (altas, asignaciones, traspasos, bajas).' })
  @ApiParam({ name: 'id', description: 'Identificador del vehículo.' })
  @ApiResponse({ status: 200, description: 'Historial de movimientos del vehículo.' })
  @ApiBearerAuth()
  @Permissions('vehicles:read')
  @Get(':id/movement-history')
  findMovementHistory(@Param('id') id: string, @Query() dto: FindVehicleMovementHistoryDto) {
    return this.vehiclesService.findMovementHistory(id, dto);
  }

  @ApiOperation({ summary: 'Actualizar vehículo', description: 'Actualiza los datos de un vehículo existente (no incluye asignación ni sucursal actual).' })
  @ApiParam({ name: 'id', description: 'Identificador del vehículo.' })
  @ApiResponse({ status: 200, description: 'Vehículo actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado.' })
  @ApiBearerAuth()
  @Permissions('vehicles:update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateVehicleItemDto: UpdateVehicleItemDto,
    @CurrentUser() user: BranchScopedUser & { id: string },
  ) {
    return this.vehiclesService.update(id, updateVehicleItemDto, user);
  }

  @ApiOperation({ summary: 'Asignar vehículo', description: 'Asigna un vehículo disponible a un empleado o a una ubicación (exclusivo, nunca ambos).' })
  @ApiParam({ name: 'id', description: 'Identificador del vehículo.' })
  @ApiResponse({ status: 200, description: 'Vehículo asignado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('vehicles:update')
  @Post(':id/assign')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignVehicleDto,
    @CurrentUser() user: BranchScopedUser & { id: string },
  ) {
    return this.vehiclesService.assign(id, dto, user);
  }

  @ApiOperation({ summary: 'Liberar vehículo', description: 'Quita la asignación de un vehículo (empleado o ubicación) y lo deja disponible.' })
  @ApiParam({ name: 'id', description: 'Identificador del vehículo.' })
  @ApiResponse({ status: 200, description: 'Vehículo liberado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('vehicles:update')
  @Post(':id/unassign')
  unassign(@Param('id') id: string, @CurrentUser() user: BranchScopedUser) {
    return this.vehiclesService.unassign(id, user);
  }

  @ApiOperation({ summary: 'Dar de baja un vehículo', description: 'Marca un vehículo como retirado/dado de baja. No elimina el registro.' })
  @ApiParam({ name: 'id', description: 'Identificador del vehículo.' })
  @ApiResponse({ status: 200, description: 'Vehículo dado de baja exitosamente.' })
  @ApiBearerAuth()
  @Permissions('vehicles:update')
  @Post(':id/retire')
  retire(
    @Param('id') id: string,
    @Body() dto: RetireVehicleDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.vehiclesService.retire(id, dto, user);
  }
}
