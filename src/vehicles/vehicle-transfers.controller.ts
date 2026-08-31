import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleTransferDto } from './dto/create-vehicle-transfer.dto';
import { FindVehicleTransfersDto } from './dto/find-vehicle-transfers.dto';
import { CancelVehicleTransferDto } from './dto/cancel-vehicle-transfer.dto';
import { RejectVehicleTransferDto } from './dto/reject-vehicle-transfer.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';

@ApiTags('vehicle-transfers')
@Controller('vehicle-transfers')
export class VehicleTransfersController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @ApiOperation({ summary: 'Crear traspaso de vehículo', description: 'Crea una solicitud de traspaso de uno o más vehículos entre sucursales (estado PENDING).' })
  @ApiResponse({ status: 201, description: 'Solicitud de traspaso creada exitosamente.' })
  @ApiBearerAuth()
  @Permissions('vehicle-transfers:create')
  @Post()
  create(@Body() dto: CreateVehicleTransferDto, @CurrentUser() user: BranchScopedUser) {
    return this.vehiclesService.createTransfer(dto, user);
  }

  @ApiOperation({ summary: 'Listar traspasos de vehículo', description: 'Devuelve las solicitudes de traspaso, con alcance según la sucursal del usuario autenticado (origen o destino).' })
  @ApiResponse({ status: 200, description: 'Listado de traspasos.' })
  @ApiBearerAuth()
  @Permissions('vehicle-transfers:read')
  @Get()
  findAll(@Query() dto: FindVehicleTransfersDto, @CurrentUser() user: BranchScopedUser) {
    return this.vehiclesService.findTransfers(dto, user);
  }

  @ApiOperation({ summary: 'Obtener traspaso de vehículo', description: 'Devuelve una solicitud de traspaso por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador de la solicitud de traspaso.' })
  @ApiResponse({ status: 200, description: 'Traspaso encontrado.' })
  @ApiResponse({ status: 404, description: 'Traspaso no encontrado.' })
  @ApiBearerAuth()
  @Permissions('vehicle-transfers:read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vehiclesService.findOneTransfer(id);
  }

  @ApiOperation({ summary: 'Iniciar traspaso', description: 'La sucursal de origen marca la salida física de los vehículos (PENDING -> IN_TRANSIT).' })
  @ApiParam({ name: 'id', description: 'Identificador de la solicitud de traspaso.' })
  @ApiResponse({ status: 200, description: 'Traspaso iniciado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('vehicle-transfers:update')
  @Post(':id/initiate')
  initiate(@Param('id') id: string, @CurrentUser() user: BranchScopedUser) {
    return this.vehiclesService.initiateTransfer(id, user);
  }

  @ApiOperation({ summary: 'Recibir traspaso', description: 'La sucursal de destino confirma la recepción de los vehículos (IN_TRANSIT -> COMPLETED).' })
  @ApiParam({ name: 'id', description: 'Identificador de la solicitud de traspaso.' })
  @ApiResponse({ status: 200, description: 'Traspaso recibido exitosamente.' })
  @ApiBearerAuth()
  @Permissions('vehicle-transfers:update')
  @Post(':id/receive')
  receive(@Param('id') id: string, @CurrentUser() user: BranchScopedUser) {
    return this.vehiclesService.receiveTransfer(id, user);
  }

  @ApiOperation({ summary: 'Cancelar traspaso', description: 'Cancela una solicitud de traspaso que aún no ha sido iniciada (solo desde PENDING).' })
  @ApiParam({ name: 'id', description: 'Identificador de la solicitud de traspaso.' })
  @ApiResponse({ status: 200, description: 'Traspaso cancelado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('vehicle-transfers:update')
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelVehicleTransferDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.vehiclesService.cancelTransfer(id, dto, user);
  }

  @ApiOperation({ summary: 'Rechazar traspaso', description: 'La sucursal de destino rechaza la recepción de un traspaso en tránsito (solo desde IN_TRANSIT).' })
  @ApiParam({ name: 'id', description: 'Identificador de la solicitud de traspaso.' })
  @ApiResponse({ status: 200, description: 'Traspaso rechazado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('vehicle-transfers:update')
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectVehicleTransferDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.vehiclesService.rejectTransfer(id, dto, user);
  }
}
