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
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CreateTicketSubcategoryDto } from './dto/create-ticket-subcategory.dto';
import { UpdateTicketSubcategoryDto } from './dto/update-ticket-subcategory.dto';
import { FindTicketSubcategoriesDto } from './dto/find-ticket-subcategories.dto';
import { TicketSubcategoriesService } from './ticket-subcategories.service';

@ApiTags('ticket-subcategories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ticket-subcategories')
export class TicketSubcategoriesController {
  constructor(
    private readonly ticketSubcategoriesService: TicketSubcategoriesService,
  ) {}

  @ApiOperation({
    summary: 'Listar subcategorías de tickets',
    description:
      'Devuelve el catálogo de subcategorías, agrupado por Category (p. ej. dentro de COGNITI: Crear cliente, Crear parámetro, ' +
      'Actualizar parámetro, Actualizar precio de parámetro). Abierto a cualquier usuario autenticado — quien reporta un ticket ' +
      'necesita esta lista para elegir subcategoría al crearlo.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de subcategorías.',
  })
  @Get()
  findAll(@Query() dto: FindTicketSubcategoriesDto) {
    return this.ticketSubcategoriesService.findAll(dto);
  }

  @ApiOperation({
    summary: 'Crear subcategoría de ticket',
    description:
      'Agrega una subcategoría al catálogo de una Category. Requiere el permiso tickets:update.',
  })
  @ApiResponse({
    status: 201,
    description: 'Subcategoría creada exitosamente.',
  })
  @Permissions('tickets:update')
  @Post()
  create(@Body() dto: CreateTicketSubcategoryDto) {
    return this.ticketSubcategoriesService.create(dto);
  }

  @ApiOperation({
    summary: 'Actualizar subcategoría de ticket',
    description:
      'Actualiza el nombre, categoría o estado (activo/inactivo) de una subcategoría. Requiere el permiso tickets:update.',
  })
  @ApiParam({ name: 'id', description: 'Identificador de la subcategoría.' })
  @ApiResponse({
    status: 200,
    description: 'Subcategoría actualizada exitosamente.',
  })
  @ApiResponse({ status: 404, description: 'Subcategoría no encontrada.' })
  @Permissions('tickets:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketSubcategoryDto,
  ) {
    return this.ticketSubcategoriesService.update(id, dto);
  }

  @ApiOperation({
    summary: 'Eliminar subcategoría de ticket',
    description:
      'Elimina una subcategoría del catálogo. Los tickets que ya la tenían asignada quedan con subcategoryId en null (no se ' +
      'bloquea el borrado ni se eliminan los tickets). Requiere el permiso tickets:update.',
  })
  @ApiParam({ name: 'id', description: 'Identificador de la subcategoría.' })
  @ApiResponse({
    status: 200,
    description: 'Subcategoría eliminada exitosamente.',
  })
  @ApiResponse({ status: 404, description: 'Subcategoría no encontrada.' })
  @Permissions('tickets:update')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.ticketSubcategoriesService.remove(id);
  }
}
