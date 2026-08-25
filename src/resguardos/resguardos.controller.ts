import { Controller, Get, Post, Body, Param, Delete, Query, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import PDFDocument = require('pdfkit');
import { ResguardosService } from './resguardos.service';
import { CreateResguardoDto } from './dto/create-resguardo.dto';
import { FindResguardosDto } from './dto/find-resguardos.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';

@ApiTags('resguardos')
@ApiBearerAuth()
@Controller('resguardos')
export class ResguardosController {
  constructor(private readonly resguardosService: ResguardosService) {}

  @ApiOperation({
    summary: 'Generar/regenerar resguardo',
    description:
      'Genera un resguardo para un empleado a partir de los equipos (cómputo/celular/vehículo) que tiene ASSIGNED en inventario en este momento. ' +
      'Normalmente no hace falta llamarlo: se dispara automáticamente al asignar un equipo (POST /devices/:id/assign). ' +
      'Útil para reconstruir el resguardo de empleados con equipo ya asignado antes de esta funcionalidad, o para forzar una regeneración.',
  })
  @ApiResponse({ status: 201, description: 'Resguardo creado exitosamente.' })
  @ApiResponse({ status: 400, description: 'El empleado no tiene ningún equipo de cómputo, celular o vehículo asignado.' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado.' })
  @Permissions('resguardos:create')
  @Post()
  create(@Body() dto: CreateResguardoDto, @CurrentUser() user: BranchScopedUser & { id: string }) {
    return this.resguardosService.create(dto, user);
  }

  @ApiOperation({ summary: 'Listar resguardos', description: 'Devuelve los resguardos, con alcance según la sucursal del usuario autenticado.' })
  @ApiResponse({ status: 200, description: 'Listado de resguardos.' })
  @Permissions('resguardos:read')
  @Get()
  findAll(@Query() dto: FindResguardosDto, @CurrentUser() user: BranchScopedUser) {
    return this.resguardosService.findAll(dto, user);
  }

  @ApiOperation({ summary: 'Obtener resguardo', description: 'Devuelve un resguardo por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiResponse({ status: 200, description: 'Resguardo encontrado.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado.' })
  @Permissions('resguardos:read')
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.resguardosService.findOne(id, user);
  }

  @ApiOperation({ summary: 'Descargar PDF de resguardo', description: 'Genera y descarga el PDF de un resguardo existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF del resguardo.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado.' })
  @Permissions('resguardos:read')
  @Get(':id/pdf')
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: BranchScopedUser,
    @Res() res: Response,
  ) {
    const resguardo = await this.resguardosService.findOne(id, user);
    this.streamPdf(res, resguardo);
  }

  @ApiOperation({ summary: 'Eliminar resguardo', description: 'Elimina un resguardo existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiResponse({ status: 200, description: 'Resguardo eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado.' })
  @Permissions('resguardos:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.resguardosService.remove(id, user);
  }

  private streamPdf(res: Response, resguardo: Parameters<ResguardosService['buildResguardoPdf']>[1]) {
    const doc = new PDFDocument({ margin: 50 }) as PDFKit.PDFDocument;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Resguardo-${resguardo.employeeName}.pdf"`);

    doc.pipe(res);
    this.resguardosService.buildResguardoPdf(doc, resguardo);
    doc.end();
  }
}
