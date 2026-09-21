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
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { CreateTicketCommentDto } from './dto/create-ticket-comment.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FindTicketNotificationsDto } from './dto/find-ticket-notifications.dto';
import { FindTicketsDto } from './dto/find-tickets.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketsService } from './tickets.service';

@ApiTags('tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @ApiOperation({
    summary: 'Crear ticket',
    description:
      'Crea un ticket de soporte de TI en la sucursal del usuario autenticado y notifica a la sala de TI en tiempo real. ' +
      'Requiere el permiso tickets:create. El ticket queda enlazado a quien lo crea (createdById): esa persona podrá ' +
      'consultarlo siempre en su histórico, sin importar si más adelante deja de estar asignada a esa sucursal.',
  })
  @ApiResponse({ status: 201, description: 'Ticket creado exitosamente.' })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no tiene el permiso tickets:create, o no tiene acceso a esa sucursal.',
  })
  @ApiResponse({
    status: 429,
    description: 'Demasiados tickets creados en poco tiempo.',
  })
  @Permissions('tickets:create')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(
    @Body() createTicketDto: CreateTicketDto,
    @CurrentUser() user: BranchScopedUser & { id: string },
  ) {
    return this.ticketsService.create(createTicketDto, user);
  }

  @ApiOperation({
    summary: 'Listar tickets',
    description:
      'Devuelve los tickets paginados, filtrables por sucursal, estado, categoría, prioridad y responsable asignado. Sin el ' +
      'permiso tickets:update, solo se devuelven los tickets reportados por el propio usuario (su histórico), sin importar ' +
      'la sucursal en la que se crearon ni las sucursales a las que el usuario esté asignado actualmente.',
  })
  @ApiResponse({ status: 200, description: 'Listado paginado de tickets.' })
  @Get()
  findAll(
    @Query() findTicketsDto: FindTicketsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsService.findAll(findTicketsDto, user);
  }

  @ApiOperation({
    summary: 'Listar mis notificaciones de tickets',
    description:
      'Devuelve las notificaciones (avisos de comentarios y cambios) del usuario autenticado, paginadas. Sirve de respaldo ' +
      'a los eventos en vivo por socket: si el usuario estaba desconectado cuando se generó el aviso, sigue apareciendo aquí.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de notificaciones.',
  })
  @Get('notifications')
  findMyNotifications(
    @Query() findTicketNotificationsDto: FindTicketNotificationsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsService.findMyNotifications(
      findTicketNotificationsDto,
      user,
    );
  }

  @ApiOperation({
    summary: 'Marcar todas mis notificaciones como leídas',
  })
  @ApiResponse({
    status: 200,
    description: 'Notificaciones marcadas como leídas.',
  })
  @Patch('notifications/read-all')
  markAllNotificationsRead(@CurrentUser() user: RequestUser) {
    return this.ticketsService.markAllNotificationsRead(user);
  }

  @ApiOperation({
    summary: 'Marcar una notificación como leída',
  })
  @ApiParam({ name: 'id', description: 'Identificador de la notificación.' })
  @ApiResponse({ status: 200, description: 'Notificación marcada como leída.' })
  @ApiResponse({
    status: 403,
    description: 'La notificación pertenece a otro usuario.',
  })
  @ApiResponse({ status: 404, description: 'Notificación no encontrada.' })
  @Patch('notifications/:id/read')
  markNotificationRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsService.markNotificationRead(id, user);
  }

  @ApiOperation({
    summary: 'Obtener ticket',
    description:
      'Devuelve un ticket por su identificador, incluyendo adjuntos y comentarios. Las notas internas (isInternal) solo ' +
      'se incluyen si el usuario tiene el permiso tickets:update; el usuario que reportó el ticket nunca las ve. Sin ese ' +
      'permiso, solo se puede consultar un ticket propio — pero siempre, sin importar la sucursal del ticket ni las ' +
      'sucursales asignadas actualmente al usuario.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiResponse({ status: 200, description: 'Ticket encontrado.' })
  @ApiResponse({
    status: 403,
    description:
      'El ticket es de otro usuario y quien consulta no tiene el permiso tickets:update, o quien tiene tickets:update no ' +
      'tiene acceso a la sucursal del ticket.',
  })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado.' })
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsService.findOne(id, user);
  }

  @ApiOperation({
    summary: 'Actualizar ticket',
    description:
      'Actualiza el estado, prioridad o responsable asignado de un ticket y notifica el cambio en tiempo real. Requiere el permiso tickets:update.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiResponse({ status: 200, description: 'Ticket actualizado exitosamente.' })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no tiene el permiso tickets:update o acceso a esa sucursal.',
  })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado.' })
  @Permissions('tickets:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTicketDto: UpdateTicketDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsService.update(id, updateTicketDto, user);
  }

  @ApiOperation({
    summary: 'Comentar ticket',
    description:
      'Agrega un comentario al ticket. Marcar isInternal:true requiere el permiso tickets:update — el usuario que reportó ' +
      'el ticket no puede crear notas internas ni verlas. Sin ese permiso, solo se puede comentar en tickets propios.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiResponse({ status: 201, description: 'Comentario creado exitosamente.' })
  @ApiResponse({
    status: 403,
    description:
      'El ticket es de otro usuario y quien comenta no tiene el permiso tickets:update, intentó crear una nota interna sin ' +
      'ese permiso, o quien tiene tickets:update no tiene acceso a la sucursal del ticket.',
  })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado.' })
  @ApiResponse({
    status: 429,
    description: 'Demasiados comentarios creados en poco tiempo.',
  })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/comments')
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTicketCommentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsService.addComment(id, dto, user);
  }
}
