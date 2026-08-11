import type { Express, Response } from 'express';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { PriceSheetsService } from './price-sheets.service';
import { CreatePriceSheetDto } from './dto/create-price-sheet.dto';
import { UpdatePriceSheetDto } from './dto/update-price-sheet.dto';
import { PaginationPriceSheetDto } from './dto/pagination-price-sheet.dto';
import { FindPriceSheetsDto } from './dto/find-price-sheets.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';

@ApiTags('price-sheets')
@Controller('price-sheets')
export class PriceSheetsController {
  constructor(private readonly priceSheetsService: PriceSheetsService) {}

  @ApiOperation({ summary: 'Crear tabulador', description: 'Crea un nuevo tabulador de precios.' })
  @ApiResponse({ status: 201, description: 'Tabulador creado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('price-sheets:create')
  @Post()
  create(@Body() createPriceSheetDto: CreatePriceSheetDto) {
    return this.priceSheetsService.create(createPriceSheetDto);
  }

  @ApiOperation({ summary: 'Listar tabuladores', description: 'Devuelve, paginados, todos los tabuladores de precios (públicos y privados) de las sucursales a las que tiene acceso el usuario autenticado. Un usuario sin sucursales asignadas ve todas.' })
  @ApiResponse({ status: 200, description: 'Listado paginado de tabuladores.' })
  @ApiBearerAuth()
  @Permissions('price-sheets:read')
  @Get()
  findAll(
    @Query() dto: FindPriceSheetsDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.priceSheetsService.findAll(dto, user);
  }

  @ApiOperation({ summary: 'Obtener tabulador', description: 'Devuelve un tabulador de precios por su identificador, público o privado, con sus estudios de forma paginada.' })
  @ApiParam({ name: 'id', description: 'Identificador del tabulador.' })
  @ApiResponse({ status: 200, description: 'Tabulador encontrado.' })
  @ApiResponse({ status: 404, description: 'Tabulador no encontrado.' })
  @ApiBearerAuth()
  @Permissions('price-sheets:read')
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query() paginationPriceSheetDto: PaginationPriceSheetDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.priceSheetsService.findOne(id, paginationPriceSheetDto, user);
  }

  @ApiOperation({ summary: 'Actualizar tabulador', description: 'Actualiza los datos de un tabulador de precios existente.' })
  @ApiParam({ name: 'id', description: 'Identificador del tabulador.' })
  @ApiResponse({ status: 200, description: 'Tabulador actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Tabulador no encontrado.' })
  @ApiBearerAuth()
  @Permissions('price-sheets:update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePriceSheetDto: UpdatePriceSheetDto) {
    return this.priceSheetsService.update(id, updatePriceSheetDto);
  }

  @ApiOperation({ summary: 'Eliminar tabulador', description: 'Elimina un tabulador de precios existente.' })
  @ApiParam({ name: 'id', description: 'Identificador del tabulador.' })
  @ApiResponse({ status: 200, description: 'Tabulador eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Tabulador no encontrado.' })
  @ApiBearerAuth()
  @Permissions('price-sheets:delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.priceSheetsService.remove(id);
  }

  @ApiOperation({
    summary: 'Descargar plantilla de importación de un tarifario',
    description:
      'Genera y descarga la plantilla Excel para cargar de forma masiva los estudios y precios de este tarifario específico.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del tabulador.' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiResponse({ status: 200, description: 'Archivo Excel de plantilla.' })
  @ApiResponse({ status: 404, description: 'Tabulador no encontrado.' })
  @ApiBearerAuth()
  @Permissions('studies:create')
  @Get(':id/import-template')
  async downloadImportTemplate(
    @Param('id') id: string,
    @CurrentUser() user: BranchScopedUser,
    @Res() res: Response,
  ) {
    const buffer = await this.priceSheetsService.generateImportTemplate(id, user);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="plantilla-tarifario.xlsx"',
    );

    res.send(buffer);
  }

  @ApiOperation({
    summary: 'Importar estudios y precios a un tarifario',
    description:
      'Procesa un archivo .xlsx/.xls para crear o actualizar los estudios de este tarifario junto con su precio, sin afectar los precios que esos estudios tengan en otros tarifarios.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del tabulador.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Archivo Excel (.xlsx o .xls) con los estudios y precios de este tarifario.',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Resultado de la importación con el detalle de éxitos y errores por fila.' })
  @ApiResponse({ status: 400, description: 'Archivo no proporcionado o de tipo inválido.' })
  @ApiResponse({ status: 404, description: 'Tabulador no encontrado.' })
  @ApiBearerAuth()
  @Permissions('studies:create')
  @Post(':id/import-excel')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: BranchScopedUser,
  ) {
    if (!file) throw new BadRequestException('File is required');

    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];

    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Solo se permite archivo Excel (.xlsx)');
    }
    return this.priceSheetsService.importStudiesFromExcel(id, file.buffer, user);
  }
}
