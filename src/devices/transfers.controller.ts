import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { FindTransfersDto } from './dto/find-transfers.dto';
import { CancelTransferDto } from './dto/cancel-transfer.dto';
import { RejectTransferDto } from './dto/reject-transfer.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';

@ApiTags('transfers')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly devicesService: DevicesService) {}

  @ApiOperation({ summary: 'Crear traspaso', description: 'Crea una solicitud de traspaso de uno o más equipos entre sucursales (estado PENDING).' })
  @ApiResponse({ status: 201, description: 'Solicitud de traspaso creada exitosamente.' })
  @ApiBearerAuth()
  @Permissions('transfers:create')
  @Post()
  create(@Body() dto: CreateTransferDto, @CurrentUser() user: BranchScopedUser) {
    return this.devicesService.createTransfer(dto, user);
  }

  @ApiOperation({ summary: 'Listar traspasos', description: 'Devuelve las solicitudes de traspaso, con alcance según la sucursal del usuario autenticado (origen o destino).' })
  @ApiResponse({ status: 200, description: 'Listado de traspasos.' })
  @ApiBearerAuth()
  @Permissions('transfers:read')
  @Get()
  findAll(@Query() dto: FindTransfersDto, @CurrentUser() user: BranchScopedUser) {
    return this.devicesService.findTransfers(dto, user);
  }

  @ApiOperation({ summary: 'Obtener traspaso', description: 'Devuelve una solicitud de traspaso por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador de la solicitud de traspaso.' })
  @ApiResponse({ status: 200, description: 'Traspaso encontrado.' })
  @ApiResponse({ status: 404, description: 'Traspaso no encontrado.' })
  @ApiBearerAuth()
  @Permissions('transfers:read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.devicesService.findOneTransfer(id);
  }

  @ApiOperation({ summary: 'Iniciar traspaso', description: 'La sucursal de origen marca la salida física de los equipos (PENDING -> IN_TRANSIT).' })
  @ApiParam({ name: 'id', description: 'Identificador de la solicitud de traspaso.' })
  @ApiResponse({ status: 200, description: 'Traspaso iniciado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('transfers:update')
  @Post(':id/initiate')
  initiate(@Param('id') id: string, @CurrentUser() user: BranchScopedUser) {
    return this.devicesService.initiateTransfer(id, user);
  }

  @ApiOperation({ summary: 'Recibir traspaso', description: 'La sucursal de destino confirma la recepción de los equipos (IN_TRANSIT -> COMPLETED).' })
  @ApiParam({ name: 'id', description: 'Identificador de la solicitud de traspaso.' })
  @ApiResponse({ status: 200, description: 'Traspaso recibido exitosamente.' })
  @ApiBearerAuth()
  @Permissions('transfers:update')
  @Post(':id/receive')
  receive(@Param('id') id: string, @CurrentUser() user: BranchScopedUser) {
    return this.devicesService.receiveTransfer(id, user);
  }

  @ApiOperation({ summary: 'Cancelar traspaso', description: 'Cancela una solicitud de traspaso que aún no ha sido iniciada (solo desde PENDING).' })
  @ApiParam({ name: 'id', description: 'Identificador de la solicitud de traspaso.' })
  @ApiResponse({ status: 200, description: 'Traspaso cancelado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('transfers:update')
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelTransferDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.devicesService.cancelTransfer(id, dto, user);
  }

  @ApiOperation({ summary: 'Rechazar traspaso', description: 'La sucursal de destino rechaza la recepción de un traspaso en tránsito (solo desde IN_TRANSIT).' })
  @ApiParam({ name: 'id', description: 'Identificador de la solicitud de traspaso.' })
  @ApiResponse({ status: 200, description: 'Traspaso rechazado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('transfers:update')
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectTransferDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.devicesService.rejectTransfer(id, dto, user);
  }
}
