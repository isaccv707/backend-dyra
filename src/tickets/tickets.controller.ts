import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
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
import { FindAssignableUsersDto } from './dto/find-assignable-users.dto';
import { FindTicketNotificationsDto } from './dto/find-ticket-notifications.dto';
import { FindTicketsDto } from './dto/find-tickets.dto';
import { SetTicketAssigneesDto } from './dto/set-ticket-assignees.dto';
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
      'Devuelve los tickets paginados, filtrables por sucursal, estado, categoría, prioridad, usuario asignado (assigneeId) ' +
      'o solo los asignados al usuario autenticado (assignedToMe=true). Sin el permiso tickets:update, solo se devuelven ' +
      'los tickets reportados por el propio usuario (su histórico) más los que tiene asignados actualmente, sin importar ' +
      'la sucursal en la que se crearon ni las sucursales a las que el usuario esté asignado.',
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
      'se incluyen si el usuario tiene el permiso tickets:update; el usuario que reportó el ticket y los asignados sin ese ' +
      'permiso nunca las ven. Sin ese permiso, solo se puede consultar un ticket propio (siempre, sin importar la sucursal) ' +
      'o uno que se tenga asignado actualmente.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiResponse({ status: 200, description: 'Ticket encontrado.' })
  @ApiResponse({
    status: 403,
    description:
      'El ticket es de otro usuario, quien consulta no está asignado y no tiene el permiso tickets:update, o quien tiene ' +
      'tickets:update no tiene acceso a la sucursal del ticket.',
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
      'Actualiza el estado, prioridad, categoría o subcategoría de un ticket y notifica el cambio en tiempo real. Los ' +
      'asignados se gestionan con PUT /tickets/:id/assignees. Requiere el permiso tickets:update.',
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
    summary: 'Listar usuarios asignables al ticket',
    description:
      'Devuelve los usuarios que se pueden asignar al ticket (para el selector de asignados): activos, con acceso a la ' +
      'sucursal del ticket y distintos de quien lo reportó, ordenados por nombre. isAssigned indica si ya están asignados. ' +
      'Filtrable por nombre o email con search. Requiere el permiso tickets:update.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiResponse({ status: 200, description: 'Listado de usuarios asignables.' })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no tiene el permiso tickets:update o acceso a esa sucursal.',
  })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado.' })
  @Permissions('tickets:update')
  @Get(':id/assignable-users')
  findAssignableUsers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() dto: FindAssignableUsersDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsService.findAssignableUsers(id, dto, user);
  }

  @ApiOperation({
    summary: 'Asignar usuarios al ticket',
    description:
      'Reemplaza la lista completa de usuarios asignados al ticket ([] lo deja sin asignar). Se puede asignar a cualquier ' +
      'usuario activo con acceso a la sucursal del ticket, excepto a quien lo reportó. Los usuarios agregados reciben un ' +
      'aviso in-app y un correo; los que se quitan pierden el acceso al ticket de inmediato. Requiere el permiso tickets:update.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiResponse({ status: 200, description: 'Asignados actualizados.' })
  @ApiResponse({
    status: 400,
    description:
      'Algún usuario está inactivo, no tiene acceso a la sucursal del ticket o es quien lo reportó.',
  })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no tiene el permiso tickets:update o acceso a esa sucursal.',
  })
  @ApiResponse({
    status: 404,
    description: 'Ticket o usuario no encontrado.',
  })
  @Permissions('tickets:update')
  @Put(':id/assignees')
  setAssignees(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTicketAssigneesDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsService.setAssignees(id, dto, user);
  }

  @ApiOperation({
    summary: 'Comentar ticket',
    description:
      'Agrega un comentario al ticket. Marcar isInternal:true requiere el permiso tickets:update — el usuario que reportó ' +
      'el ticket y los asignados sin ese permiso no pueden crear notas internas ni verlas. Sin ese permiso, solo se puede ' +
      'comentar en tickets propios o asignados.',
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

  @ApiOperation({
    summary: 'Editar formulario del ticket',
    description:
      'Reemplaza los datos del formulario del ticket (p. ej. el alta de parámetro de CogniTI) mientras no haya sido aprobado ' +
      'y el ticket no esté cerrado ni cancelado. El cuerpo tiene la misma forma que el campo form al crear el ticket. ' +
      'Solo quien reportó el ticket o un usuario con tickets:update (en su sucursal) pueden editarlo.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiBody({ schema: { type: 'object' } })
  @ApiResponse({ status: 200, description: 'Formulario actualizado.' })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos, el ticket no tiene formulario o está cerrado/cancelado.',
  })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no es quien reportó el ticket ni tiene tickets:update.',
  })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado.' })
  @ApiResponse({ status: 409, description: 'El formulario ya fue aprobado.' })
  @Patch(':id/form')
  updateForm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsService.updateForm(id, body, user);
  }

  @ApiOperation({
    summary: 'Aprobar formulario del ticket',
    description:
      'TI aprueba el formulario y el sistema ejecuta la acción solicitada. Para STUDY_CREATE crea el Study en la sucursal ' +
      'del ticket con los datos del formulario más los que captura TI en el cuerpo: code y serviceId (obligatorios), title, ' +
      'abbreviation, description, deliveryTime, preparation e isOrderable (opcionales). Se vuelven a validar catálogos y ' +
      'tarifarios. Si es un perfil con panelItems, newStudies trae el code (y opcionalmente title, abbreviation, serviceId…) ' +
      'de cada parámetro nuevo en el mismo orden; los hijos nuevos se crean sin precios y con isOrderable=false, y se ' +
      'enlazan al perfil junto con los existentes (si algo falla, se revierte lo creado). Para STUDY_UPDATE aplica solo los campos y precios por tarifario que difieren del parámetro actual (más ' +
      'los ajustes opcionales de TI: code, title, abbreviation, etc.) y guarda el antes/después en form.result. ' +
      'No cambia el estado del ticket. Requiere el permiso tickets:update.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiBody({ schema: { type: 'object' } })
  @ApiResponse({ status: 201, description: 'Formulario aprobado.' })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos, catálogos o tarifarios ya no válidos, o el ticket no tiene formulario / está cerrado o cancelado.',
  })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no tiene el permiso tickets:update o acceso a esa sucursal.',
  })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado.' })
  @ApiResponse({
    status: 409,
    description:
      'El formulario ya fue aprobado, o ya existe un estudio con ese code en la sucursal.',
  })
  @Permissions('tickets:update')
  @Post(':id/form/apply')
  applyForm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsService.applyForm(id, body, user);
  }
}
