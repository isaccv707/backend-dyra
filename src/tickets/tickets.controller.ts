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
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { AttachmentDto } from './dto/attachment.dto';
import { CreateTicketCommentDto } from './dto/create-ticket-comment.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
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
      'Crea un ticket de soporte de TI en la sucursal del usuario autenticado y notifica a la sala de TI en tiempo real.',
  })
  @ApiResponse({ status: 201, description: 'Ticket creado exitosamente.' })
  @ApiResponse({
    status: 403,
    description: 'El usuario no tiene acceso a esa sucursal.',
  })
  @Post()
  create(
    @Body() createTicketDto: CreateTicketDto,
    @CurrentUser() user: BranchScopedUser & { id: string },
  ) {
    return this.ticketsService.create(createTicketDto, user);
  }

  @ApiOperation({
    summary: 'Solicitar firma de subida a Cloudinary',
    description:
      'Genera los parámetros firmados para que el frontend suba un adjunto (foto, documento, etc.) directo a Cloudinary a ' +
      'POST https://api.cloudinary.com/v1_1/{cloudName}/auto/upload, público y sin expiración (a diferencia de los documentos ' +
      'firmados de resguardos). La URL resultante se manda en el array `attachments` al crear el ticket, o después a ' +
      'POST /tickets/:id/attachments para adjuntarla a un ticket ya existente.',
  })
  @ApiResponse({ status: 200, description: 'Parámetros firmados generados.' })
  @Post('upload-signature')
  createUploadSignature() {
    return this.ticketsService.createUploadSignature();
  }

  @ApiOperation({
    summary: 'Listar tickets',
    description:
      'Devuelve los tickets paginados, filtrables por sucursal, estado, categoría, prioridad y responsable asignado.',
  })
  @ApiResponse({ status: 200, description: 'Listado paginado de tickets.' })
  @Get()
  findAll(
    @Query() findTicketsDto: FindTicketsDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.ticketsService.findAll(findTicketsDto, user);
  }

  @ApiOperation({
    summary: 'Obtener ticket',
    description:
      'Devuelve un ticket por su identificador, incluyendo adjuntos y comentarios. Las notas internas (isInternal) solo ' +
      'se incluyen si el usuario tiene el permiso tickets:update; el usuario que reportó el ticket nunca las ve.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiResponse({ status: 200, description: 'Ticket encontrado.' })
  @ApiResponse({
    status: 403,
    description: 'El usuario no tiene acceso a esa sucursal.',
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
    summary: 'Adjuntar archivo a un ticket',
    description:
      'Agrega un adjunto (ya subido a Cloudinary vía POST /tickets/upload-signature) a un ticket existente — por ejemplo, ' +
      'evidencia de la solución al resolver el ticket.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiResponse({ status: 201, description: 'Adjunto agregado exitosamente.' })
  @ApiResponse({
    status: 403,
    description: 'El usuario no tiene acceso a esa sucursal.',
  })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado.' })
  @Post(':id/attachments')
  addAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachmentDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.ticketsService.addAttachment(id, dto, user);
  }

  @ApiOperation({
    summary: 'Comentar ticket',
    description:
      'Agrega un comentario al ticket. Marcar isInternal:true requiere el permiso tickets:update — el usuario que reportó ' +
      'el ticket no puede crear notas internas ni verlas.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del ticket.' })
  @ApiResponse({ status: 201, description: 'Comentario creado exitosamente.' })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no tiene acceso a esa sucursal, o intentó crear una nota interna sin el permiso tickets:update.',
  })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado.' })
  @Post(':id/comments')
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTicketCommentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsService.addComment(id, dto, user);
  }
}
