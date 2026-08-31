import { Controller, Get, Post, Body, Param, Delete, Query, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import PDFDocument = require('pdfkit');
import { VehicleSafeguardsService } from './vehicle-safeguards.service';
import { CreateVehicleSafeguardDto } from './dto/create-vehicle-safeguard.dto';
import { FindVehicleSafeguardsDto } from './dto/find-vehicle-safeguards.dto';
import { SignVehicleSafeguardDto } from './dto/sign-vehicle-safeguard.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';

@ApiTags('vehicle-safeguards')
@ApiBearerAuth()
@Controller('vehicle-safeguards')
export class VehicleSafeguardsController {
  constructor(private readonly vehicleSafeguardsService: VehicleSafeguardsService) {}

  @ApiOperation({
    summary: 'Generar/regenerar resguardo de vehículo',
    description:
      'Genera un resguardo para un empleado a partir del vehículo que tiene ASSIGNED en inventario en este momento. ' +
      'Normalmente no hace falta llamarlo: se dispara automáticamente al asignar un vehículo (POST /vehicles/:id/assign).',
  })
  @ApiResponse({ status: 201, description: 'Resguardo creado exitosamente.' })
  @ApiResponse({ status: 400, description: 'El empleado no tiene ningún vehículo asignado actualmente.' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado.' })
  @Permissions('vehicle-safeguards:create')
  @Post()
  create(@Body() dto: CreateVehicleSafeguardDto, @CurrentUser() user: BranchScopedUser & { id: string }) {
    return this.vehicleSafeguardsService.create(dto, user);
  }

  @ApiOperation({ summary: 'Listar resguardos de vehículo', description: 'Devuelve los resguardos de vehículo, con alcance según la sucursal del usuario autenticado.' })
  @ApiResponse({ status: 200, description: 'Listado de resguardos de vehículo.' })
  @Permissions('vehicle-safeguards:read')
  @Get()
  findAll(@Query() dto: FindVehicleSafeguardsDto, @CurrentUser() user: BranchScopedUser) {
    return this.vehicleSafeguardsService.findAll(dto, user);
  }

  @ApiOperation({ summary: 'Obtener resguardo de vehículo', description: 'Devuelve un resguardo de vehículo por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiResponse({ status: 200, description: 'Resguardo encontrado.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado.' })
  @Permissions('vehicle-safeguards:read')
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.vehicleSafeguardsService.findOne(id, user);
  }

  @ApiOperation({ summary: 'Descargar PDF de resguardo de vehículo', description: 'Genera y descarga el PDF de un resguardo de vehículo existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF del resguardo.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado.' })
  @Permissions('vehicle-safeguards:read')
  @Get(':id/pdf')
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: BranchScopedUser,
    @Res() res: Response,
  ) {
    const safeguard = await this.vehicleSafeguardsService.findOne(id, user);
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
  @Permissions('vehicle-safeguards:update')
  @Post(':id/upload-signature')
  createUploadSignature(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.vehicleSafeguardsService.createUploadSignature(id, user);
  }

  @ApiOperation({
    summary: 'Firmar resguardo de vehículo',
    description:
      'Confirma la firma de la versión vigente de un resguardo de vehículo, opcionalmente adjuntando el public_id ' +
      'de Cloudinary del PDF firmado escaneado (type: authenticated, resource_type: raw).',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiResponse({ status: 200, description: 'Resguardo marcado como firmado.' })
  @ApiResponse({ status: 400, description: 'No se puede firmar una versión histórica del resguardo.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado.' })
  @Permissions('vehicle-safeguards:update')
  @Post(':id/sign')
  sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignVehicleSafeguardDto,
    @CurrentUser() user: BranchScopedUser & { id: string },
  ) {
    return this.vehicleSafeguardsService.sign(id, dto, user);
  }

  @ApiOperation({
    summary: 'Obtener URL del documento firmado',
    description: 'Genera una URL de descarga firmada y con expiración (Cloudinary) del PDF firmado adjunto a este resguardo.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiResponse({ status: 200, description: 'URL firmada generada.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado o sin documento firmado adjunto.' })
  @Permissions('vehicle-safeguards:read')
  @Get(':id/signed-document')
  getSignedDocument(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.vehicleSafeguardsService.getSignedDocumentUrl(id, user);
  }

  @ApiOperation({ summary: 'Eliminar resguardo de vehículo', description: 'Elimina un resguardo de vehículo existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del resguardo.' })
  @ApiResponse({ status: 200, description: 'Resguardo eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Resguardo no encontrado.' })
  @Permissions('vehicle-safeguards:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.vehicleSafeguardsService.remove(id, user);
  }

  private streamPdf(res: Response, safeguard: Parameters<VehicleSafeguardsService['buildSafeguardPdf']>[1]) {
    const doc = new PDFDocument({ margin: 50 }) as PDFKit.PDFDocument;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Resguardo-Vehiculo-${safeguard.employeeName}.pdf"`);

    doc.pipe(res);
    this.vehicleSafeguardsService.buildSafeguardPdf(doc, safeguard);
    doc.end();
  }
}
