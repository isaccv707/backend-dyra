// src/quotations/quotations.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import PDFDocument = require('pdfkit');
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { FindQuotationsDto } from './dto/find-quotations.dto';
import { QuotationsService } from './quotations.service';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';

@ApiTags('quotations')
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @ApiOperation({ summary: 'Generar cotización en PDF', description: 'Crea una cotización con los estudios seleccionados y devuelve el PDF generado.' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 201, description: 'PDF de la cotización generado exitosamente.' })
  @Public()
  @Post('pdf')
  async generatePdf(@Body() dto: CreateQuotationDto, @Res() res: Response) {
    const quotation = await this.quotationsService.create(dto);
    this.streamPdf(res, quotation);
  }

  @ApiOperation({ summary: 'Listar cotizaciones', description: 'Devuelve las cotizaciones con alcance según la sucursal del usuario autenticado.' })
  @ApiResponse({ status: 200, description: 'Listado de cotizaciones.' })
  @ApiBearerAuth()
  @Permissions('quotations:read')
  @Get()
  findAll(@Query() dto: FindQuotationsDto, @CurrentUser() user: BranchScopedUser) {
    return this.quotationsService.findAll(dto, user);
  }

  @ApiOperation({ summary: 'Obtener cotización', description: 'Devuelve una cotización por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) de la cotización.' })
  @ApiResponse({ status: 200, description: 'Cotización encontrada.' })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada.' })
  @ApiBearerAuth()
  @Permissions('quotations:read')
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.quotationsService.findOne(id, user);
  }

  @ApiOperation({ summary: 'Descargar PDF de cotización', description: 'Genera y descarga el PDF de una cotización existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) de la cotización.' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF de la cotización.' })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada.' })
  @ApiBearerAuth()
  @Permissions('quotations:read')
  @Get(':id/pdf')
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: BranchScopedUser,
    @Res() res: Response,
  ) {
    const quotation = await this.quotationsService.findOne(id, user);
    this.streamPdf(res, quotation);
  }

  @ApiOperation({ summary: 'Eliminar cotización', description: 'Elimina una cotización existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) de la cotización.' })
  @ApiResponse({ status: 200, description: 'Cotización eliminada exitosamente.' })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada.' })
  @ApiBearerAuth()
  @Permissions('quotations:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.quotationsService.remove(id, user);
  }

  private streamPdf(res: Response, quotation: Parameters<QuotationsService['buildQuotationPdf']>[1]) {
    const doc = new PDFDocument({ margin: 50 }) as PDFKit.PDFDocument;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${quotation.folio}.pdf"`);

    doc.pipe(res);
    this.quotationsService.buildQuotationPdf(doc, quotation);
    doc.end();
  }
}
