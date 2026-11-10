import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { ContactMessagesService } from './contact-messages.service';
import {
  ContactMessageReceivedDto,
  CreateContactMessageDto,
} from './dto/create-contact-message.dto';
import {
  ContactMessagesPendingCountQueryDto,
  FindContactMessagesDto,
} from './dto/find-contact-messages.dto';
import { UpdateContactMessageStatusDto } from './dto/update-contact-message-status.dto';

@ApiTags('contact-messages')
@Controller('contact-messages')
export class ContactMessagesController {
  constructor(
    private readonly contactMessagesService: ContactMessagesService,
  ) {}

  @ApiOperation({
    summary: 'Enviar mensaje de contacto (sitio público)',
    description:
      'Guarda el mensaje del formulario /contact en la sucursal indicada con estatus NEW y avisa por correo a los usuarios con contact-messages:update de esa sucursal. Requiere aceptar el aviso de privacidad.',
  })
  @ApiResponse({ status: 201, type: ContactMessageReceivedDto })
  @ApiResponse({
    status: 404,
    description: 'Sucursal no encontrada o inactiva.',
  })
  @ApiResponse({
    status: 429,
    description: 'Demasiados envíos en poco tiempo.',
  })
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post()
  create(@Body() dto: CreateContactMessageDto) {
    return this.contactMessagesService.create(dto);
  }

  @ApiOperation({
    summary: 'Listar mensajes de contacto',
    description:
      'Paginado, filtrable por sucursal, estatus y asunto; búsqueda por nombre, correo o teléfono. Limitado a las sucursales del usuario.',
  })
  @ApiBearerAuth()
  @Permissions('contact-messages:read')
  @Get()
  findAll(
    @Query() dto: FindContactMessagesDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.contactMessagesService.findAll(dto, user);
  }

  @ApiOperation({
    summary: 'Contar mensajes nuevos',
    description:
      'Mensajes con estatus NEW en las sucursales del usuario (badge del menú).',
  })
  @ApiBearerAuth()
  @Permissions('contact-messages:read')
  @Get('pending-count')
  countPending(
    @Query() dto: ContactMessagesPendingCountQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.contactMessagesService.countPending(user, dto.branchId);
  }

  @ApiOperation({
    summary: 'Detalle de mensaje de contacto',
    description: 'Incluye el historial de estatus con quién y cuándo.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'Mensaje no encontrado.' })
  @ApiBearerAuth()
  @Permissions('contact-messages:read')
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.contactMessagesService.findOne(id, user);
  }

  @ApiOperation({
    summary: 'Cambiar estatus / agregar seguimiento',
    description:
      'Cambia el estatus y/o registra una nota interna. Cada llamada queda en el historial.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 400, description: 'Mismo estatus sin nota.' })
  @ApiResponse({ status: 404, description: 'Mensaje no encontrado.' })
  @ApiBearerAuth()
  @Permissions('contact-messages:update')
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactMessageStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.contactMessagesService.updateStatus(id, dto, user);
  }
}
