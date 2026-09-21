import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { FindTicketAnalyticsDto } from './dto/find-ticket-analytics.dto';
import { FindTicketTrendDto } from './dto/find-ticket-trend.dto';
import { ExportTicketAnalyticsDto } from './dto/export-ticket-analytics.dto';
import { TicketsAnalyticsService } from './tickets-analytics.service';

@ApiTags('tickets-analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Permissions('tickets:update')
@Controller('tickets/analytics')
export class TicketsAnalyticsController {
  constructor(
    private readonly ticketsAnalyticsService: TicketsAnalyticsService,
  ) {}

  @ApiOperation({
    summary: 'Resumen de tickets',
    description:
      'Totales por estado/prioridad/categoría, tiempos promedio de primera respuesta y resolución, tasa de reapertura y ' +
      'tickets vencidos (SLA), filtrable por rango de fechas, sucursal, categoría y prioridad. Requiere tickets:update.',
  })
  @ApiResponse({ status: 200, description: 'Resumen de tickets.' })
  @Get('summary')
  getSummary(
    @Query() dto: FindTicketAnalyticsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsAnalyticsService.getSummary(dto, user);
  }

  @ApiOperation({
    summary: 'Tickets por usuario',
    description:
      'Tickets reportados por cada usuario en el rango, con desglose por estado y tiempo promedio de resolución. Requiere tickets:update.',
  })
  @ApiResponse({ status: 200, description: 'Listado de tickets por usuario.' })
  @Get('by-user')
  getByUser(
    @Query() dto: FindTicketAnalyticsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsAnalyticsService.getByUser(dto, user);
  }

  @ApiOperation({
    summary: 'Tickets por responsable asignado',
    description:
      'Carga de trabajo de cada técnico de TI: tickets asignados, tickets reabiertos y tiempo promedio de resolución. Requiere tickets:update.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado de tickets por responsable asignado.',
  })
  @Get('by-assignee')
  getByAssignee(
    @Query() dto: FindTicketAnalyticsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsAnalyticsService.getByAssignee(dto, user);
  }

  @ApiOperation({
    summary: 'Tickets por categoría y subcategoría',
    description:
      'Qué se levanta más: conteo por Category y, dentro de cada una, por subcategoría (p. ej. dentro de COGNITI: Crear ' +
      'cliente, Crear parámetro, Actualizar parámetro, Actualizar precio de parámetro). Requiere tickets:update.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado de tickets por categoría y subcategoría.',
  })
  @Get('by-category')
  getByCategory(
    @Query() dto: FindTicketAnalyticsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ticketsAnalyticsService.getByCategory(dto, user);
  }

  @ApiOperation({
    summary: 'Tendencia de tickets',
    description:
      'Serie temporal de tickets creados vs. resueltos, agrupada por día/semana/mes (interval). Requiere tickets:update.',
  })
  @ApiResponse({ status: 200, description: 'Serie temporal de tickets.' })
  @Get('trend')
  getTrend(@Query() dto: FindTicketTrendDto, @CurrentUser() user: RequestUser) {
    return this.ticketsAnalyticsService.getTrend(dto, user);
  }

  @ApiOperation({
    summary: 'Exportar reporte de tickets',
    description:
      'Descarga el resumen, el desglose por categoría/subcategoría y por usuario como Excel (.xlsx) o PDF, según format. Requiere tickets:update.',
  })
  @ApiResponse({ status: 200, description: 'Archivo de reporte descargable.' })
  @Get('export')
  async export(
    @Query() dto: ExportTicketAnalyticsDto,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const { buffer, contentType, filename } =
      await this.ticketsAnalyticsService.exportReport(dto, user);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
