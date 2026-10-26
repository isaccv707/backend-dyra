import {
  Body,
  Controller,
  Delete,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { DeletedCountDto } from '../dto/ticket-response.dto';
import {
  CreateTicketReplyTemplateDto,
  FindTicketReplyTemplatesDto,
  TicketReplyTemplateDto,
  UpdateTicketReplyTemplateDto,
} from './dto/ticket-reply-template.dto';
import { TicketReplyTemplatesService } from './ticket-reply-templates.service';

@ApiTags('ticket-reply-templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Permissions('tickets:update')
@Controller('ticket-reply-templates')
export class TicketReplyTemplatesController {
  constructor(private readonly templates: TicketReplyTemplatesService) {}

  @ApiOperation({
    summary: 'Listar plantillas de respuesta',
    description:
      'Respuestas predefinidas que TI inserta en los comentarios, por sucursal. Requiere tickets:update y acceso a la sucursal.',
  })
  @ApiResponse({ status: 200, type: [TicketReplyTemplateDto] })
  @Get()
  findAll(
    @Query() dto: FindTicketReplyTemplatesDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.templates.findAll(dto.branchId, user);
  }

  @ApiOperation({ summary: 'Crear plantilla de respuesta' })
  @ApiResponse({ status: 201, type: TicketReplyTemplateDto })
  @ApiResponse({ status: 409, description: 'Título repetido en la sucursal.' })
  @Post()
  create(
    @Body() dto: CreateTicketReplyTemplateDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.templates.create(dto, user);
  }

  @ApiOperation({ summary: 'Editar plantilla de respuesta' })
  @ApiResponse({ status: 200, type: TicketReplyTemplateDto })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketReplyTemplateDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.templates.update(id, dto, user);
  }

  @ApiOperation({ summary: 'Borrar plantilla de respuesta' })
  @ApiResponse({ status: 200, type: DeletedCountDto })
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.templates.remove(id, user);
  }
}
