import { Controller, Get, Post, Body, Param, Delete, Query, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import PDFDocument = require('pdfkit');
import { SafeguardsService } from './safeguards.service';
import { CreateSafeguardDto } from './dto/create-safeguard.dto';
import { FindSafeguardsDto } from './dto/find-safeguards.dto';
import { SignSafeguardDto } from './dto/sign-safeguard.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';

@ApiTags('safeguards')
@ApiBearerAuth()
@Controller('safeguards')
export class SafeguardsController {
  constructor(private readonly safeguardsService: SafeguardsService) {}

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
  @Permissions('safeguards:create')
  @Post()
  create(@Body() dto: CreateSafeguardDto, @CurrentUser() user: BranchScopedUser & { id: string }) {
    return this.safeguardsService.create(dto, user);
  }

  @ApiOperation({ summary: 'Listar resguardos', description: 'Devuelve los resguardos, con alcance según la sucursal del usuario autenticado.' })
  @ApiResponse({ status: 200, description: 'Listado de resguardos.' })
  @Permissions('safeguards:read')
  @Get()
  findAll(@Query() dto: FindSafeguardsDto, @CurrentUser() user: BranchScopedUser) {
    return this.safeguardsService.findAll(dto, user);
  }

  @ApiOperation({ summary: 'Obtener resguardo', description: 'Devuelve un resguardo por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiResponse({ status: 200, description: 'Resguardo encontrado.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado.' })
  @Permissions('safeguards:read')
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.safeguardsService.findOne(id, user);
  }

  @ApiOperation({ summary: 'Descargar PDF de resguardo', description: 'Genera y descarga el PDF de un resguardo existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF del resguardo.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado.' })
  @Permissions('safeguards:read')
  @Get(':id/pdf')
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: BranchScopedUser,
    @Res() res: Response,
  ) {
    const safeguard = await this.safeguardsService.findOne(id, user);
    this.streamPdf(res, safeguard);
  }

  @ApiOperation({
    summary: 'Solicitar firma de subida a Cloudinary',
    description:
      'Genera los parámetros firmados (timestamp + signature) para que el frontend suba el PDF firmado escaneado ' +
      'directo a Cloudinary a POST https://api.cloudinary.com/v1_1/{cloudName}/raw/upload, con folder, type y ' +
      'resource_type fijados por el backend. El public_id resultante se manda después a POST /:id/sign.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiResponse({ status: 200, description: 'Parámetros firmados generados.' })
  @ApiResponse({ status: 400, description: 'No se puede adjuntar un documento a una versión histórica del resguardo.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado.' })
  @Permissions('safeguards:update')
  @Post(':id/upload-signature')
  createUploadSignature(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.safeguardsService.createUploadSignature(id, user);
  }

  @ApiOperation({
    summary: 'Firmar resguardo',
    description:
      'Confirma la firma de la versión vigente de un resguardo, opcionalmente adjuntando el public_id de Cloudinary ' +
      'del PDF firmado escaneado (subido previamente por el frontend con type: authenticated, resource_type: raw).',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiResponse({ status: 200, description: 'Resguardo marcado como firmado.' })
  @ApiResponse({ status: 400, description: 'No se puede firmar una versión histórica del resguardo.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado.' })
  @Permissions('safeguards:update')
  @Post(':id/sign')
  sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignSafeguardDto,
    @CurrentUser() user: BranchScopedUser & { id: string },
  ) {
    return this.safeguardsService.sign(id, dto, user);
  }

  @ApiOperation({
    summary: 'Obtener URL del documento firmado',
    description: 'Genera una URL de descarga firmada y con expiración (Cloudinary) del PDF firmado adjunto a este resguardo.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiResponse({ status: 200, description: 'URL firmada generada.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado o sin documento firmado adjunto.' })
  @Permissions('safeguards:read')
  @Get(':id/signed-document')
  getSignedDocument(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.safeguardsService.getSignedDocumentUrl(id, user);
  }

  @ApiOperation({ summary: 'Eliminar resguardo', description: 'Elimina un resguardo existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiResponse({ status: 200, description: 'Resguardo eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado.' })
  @Permissions('safeguards:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.safeguardsService.remove(id, user);
  }

  private streamPdf(res: Response, safeguard: Parameters<SafeguardsService['buildSafeguardPdf']>[1]) {
    const doc = new PDFDocument({ margin: 50 }) as PDFKit.PDFDocument;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Resguardo-${safeguard.employeeName}.pdf"`);

    doc.pipe(res);
    this.safeguardsService.buildSafeguardPdf(doc, safeguard);
    doc.end();
  }
}
