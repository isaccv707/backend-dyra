import {
  Body,
  Controller,
  Delete,
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
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { CreateTicketCommentDto } from './dto/create-ticket-comment.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FindAssignableUsersDto } from './dto/find-assignable-users.dto';
import {
  FindTicketNotificationsDto,
  PurgeTicketNotificationsDto,
} from './dto/find-ticket-notifications.dto';
import { RejectTicketFormDto } from './dto/reject-ticket-form.dto';
import { FindTicketsDto } from './dto/find-tickets.dto';
import { SetTicketAssigneesDto } from './dto/set-ticket-assignees.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import {
  TICKET_FORM_APPLY_DTOS,
  TICKET_FORM_DTOS,
} from './forms/ticket-form-dtos';
import { TicketsService } from './tickets.service';
import { TicketNotificationsService } from './notifications/ticket-notifications.service';
import { TicketCommentsService } from './comments/ticket-comments.service';
import { TicketAssigneesService } from './assignees/ticket-assignees.service';
import { TicketFormWorkflowService } from './forms/ticket-form-workflow.service';

@ApiTags('tickets')
@ApiExtraModels(...TICKET_FORM_DTOS, ...TICKET_FORM_APPLY_DTOS)
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly notifications: TicketNotificationsService,
    private readonly comments: TicketCommentsService,
    private readonly assignees: TicketAssigneesService,
    private readonly formWorkflow: TicketFormWorkflowService,
  ) {}

  @ApiOperation({
    summary: 'Crear ticket',
    description:
      'Crea un ticket de soporte de TI en la sucursal del usuario autenticado y notifica a la sala de TI en tiempo real. ' +
      'La categoría define los datos: HARDWARE/OTHER piden title, priority y description; SOFTWARE además form ' +
      '(SoftwareRemoteFormDto); ACCESS solo form (AccessRequestFormDto); COGNITI exige subcategoryId y su formType define ' +
      'el form (StudyCreateFormDto, StudyUpdateFormDto, ClientCreateFormDto, ReferenceValuesUpdateFormDto). Con ACCESS y COGNITI el título se genera ' +
      'del formulario. El formulario no ejecuta nada hasta que TI lo aprueba (POST /tickets/:id/form/apply). ' +
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
  // Flood guard only: the 10-per-minute quota is counted on created tickets
  // (TicketsService), so rejected forms can be fixed and resent.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  create(
    @Body() createTicketDto: CreateTicketDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsService.create(createTicketDto, user);
  }

  @ApiOperation({
    summary: 'Listar tickets',
    description:
      'Devuelve los tickets paginados, filtrables por sucursal, estado, categoría, prioridad, usuario asignado (assigneeId) ' +
      'o solo los asignados al usuario autenticado (assignedToMe=true). Sin el permiso tickets:update, solo se devuelven ' +
      'los tickets reportados por el propio usuario (su histórico) más los que tiene asignados actualmente; mine=true aplica ' +
      'esa misma regla a quien sí tiene tickets:update ("Mis tickets"). En ese modo, branchId acota los creados y asignados ' +
      'a esa sucursal, pero los asignados en sucursales a las que el usuario no tiene acceso siempre se incluyen.',
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
    return this.notifications.findMine(findTicketNotificationsDto, user);
  }

  @ApiOperation({
    summary: 'Roles para solicitudes de acceso',
    description:
      'Roles que se pueden pedir en el formulario de Accesos (id, name, description). Requiere el permiso tickets:create.',
  })
  @ApiResponse({ status: 200, description: 'Listado de roles.' })
  @Permissions('tickets:create')
  @Get('form-options/roles')
  findFormRoles() {
    return this.formWorkflow.findFormRoles();
  }

  @ApiOperation({
    summary: 'Borrar mis notificaciones',
    description:
      'Borra las notificaciones leídas del usuario autenticado, o todas con all=true. Las leídas de más de 90 días se borran solas.',
  })
  @ApiResponse({ status: 200, description: 'Cantidad borrada ({ deleted }).' })
  @Delete('notifications')
  purgeMyNotifications(
    @Query() dto: PurgeTicketNotificationsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notifications.purgeMine(user, dto.all ?? false);
  }

  @ApiOperation({ summary: 'Borrar una notificación' })
  @ApiParam({ name: 'id', description: 'Identificador de la notificación.' })
  @ApiResponse({ status: 200, description: 'Notificación borrada.' })
  @ApiResponse({
    status: 403,
    description: 'La notificación pertenece a otro usuario.',
  })
  @ApiResponse({ status: 404, description: 'Notificación no encontrada.' })
  @Delete('notifications/:id')
  removeNotification(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notifications.remove(id, user);
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
    return this.notifications.markAllRead(user);
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
    return this.notifications.markRead(id, user);
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
    return this.assignees.findAssignableUsers(id, dto, user);
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
    return this.assignees.setAssignees(id, dto, user);
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
    return this.comments.addComment(id, dto, user);
  }

  @ApiOperation({
    summary: 'Editar formulario del ticket',
    description:
      'Reemplaza los datos del formulario mientras no haya sido aprobado y el ticket no esté cerrado ni cancelado. ' +
      'El cuerpo tiene la misma forma que el campo form al crear el ticket y se valida igual. Solo quien reportó el ' +
      'ticket o un usuario con tickets:update (en su sucursal) pueden editarlo.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiBody({
    schema: {
      oneOf: TICKET_FORM_DTOS.map((dto) => ({ $ref: getSchemaPath(dto) })),
    },
  })
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
    return this.formWorkflow.updateForm(id, body, user);
  }

  @ApiOperation({
    summary: 'Aprobar formulario del ticket',
    description:
      'TI aprueba la solicitud y el sistema ejecuta la acción; todo se revierte si algo falla. STUDY_CREATE crea el ' +
      'estudio o perfil en la sucursal del ticket con el code (y opcionalmente title, abbreviation, slug) que captura TI ' +
      '(ApplyStudyCreateFormDto); newStudies trae el code de cada parámetro nuevo del perfil, en orden. STUDY_UPDATE ' +
      'aplica los cambios (más ajustes opcionales de TI, ApplyStudyUpdateFormDto) y guarda el antes/después en ' +
      'form.result. REFERENCE_VALUES_UPDATE reemplaza los valores de referencia de un parámetro (sin datos de TI). ACCESS_REQUEST crea el usuario (TI puede cambiar el rol con roleId) y le envía un correo para definir su contraseña. ' +
      'SOFTWARE_REMOTE y CLIENT_CREATE son informativos (400). El ticket pasa a Resuelto. Requiere tickets:update y el ' +
      'permiso de la acción: studies:create, studies:update o users:create.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiBody({
    required: false,
    schema: {
      oneOf: TICKET_FORM_APPLY_DTOS.map((dto) => ({
        $ref: getSchemaPath(dto),
      })),
    },
  })
  @ApiResponse({ status: 201, description: 'Solicitud aprobada y aplicada.' })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos o ya no válidos (catálogos, tarifarios), formulario informativo, o ticket cerrado/cancelado.',
  })
  @ApiResponse({
    status: 403,
    description:
      'Falta tickets:update o el permiso de la acción, o no hay acceso a la sucursal.',
  })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado.' })
  @ApiResponse({
    status: 409,
    description:
      'El formulario ya fue aprobado, o ya existe un estudio con ese code o un usuario con ese correo.',
  })
  @Permissions('tickets:update')
  @Post(':id/form/apply')
  applyForm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: RequestUser,
  ) {
    return this.formWorkflow.applyForm(id, body, user);
  }

  @ApiOperation({
    summary: 'Validar la aprobación sin aplicarla',
    description:
      'Recibe el mismo cuerpo que POST /tickets/:id/form/apply y hace exactamente lo mismo dentro de una transacción ' +
      'que se revierte: responde { valid, summary } si la aprobación funcionaría, o el mismo error que daría (400/403/409). ' +
      'No guarda nada. Requiere tickets:update y el permiso de la acción.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiBody({
    required: false,
    schema: {
      oneOf: TICKET_FORM_APPLY_DTOS.map((dto) => ({
        $ref: getSchemaPath(dto),
      })),
    },
  })
  @ApiResponse({ status: 201, description: 'La aprobación funcionaría.' })
  @Permissions('tickets:update')
  @Post(':id/form/validate')
  validateForm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: RequestUser,
  ) {
    return this.formWorkflow.validateForm(id, body, user);
  }

  @ApiOperation({
    summary: 'Rechazar la solicitud',
    description:
      'TI rechaza el formulario con un motivo (queda en el historial y se notifica a quien lo reportó). El formulario ' +
      'ya no se puede editar ni aprobar y el ticket pasa a Cancelado. Requiere tickets:update.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiResponse({ status: 201, description: 'Solicitud rechazada.' })
  @ApiResponse({
    status: 409,
    description: 'El formulario ya fue aprobado o rechazado.',
  })
  @Permissions('tickets:update')
  @Post(':id/form/reject')
  rejectForm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTicketFormDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.formWorkflow.rejectForm(id, dto.reason, user);
  }

  @ApiOperation({
    summary: 'Reenviar el correo de acceso',
    description:
      'Vuelve a enviar a un usuario creado por una solicitud de acceso aprobada el correo para definir su contraseña. ' +
      'Actualiza form.result.emailSent. Requiere tickets:update y users:create.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiResponse({ status: 201, description: 'Correo enviado.' })
  @ApiResponse({ status: 503, description: 'El servidor de correo falló.' })
  @Permissions('tickets:update')
  @Post(':id/form/resend-access-email')
  resendAccessEmail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.formWorkflow.resendAccessEmail(id, user);
  }
}
