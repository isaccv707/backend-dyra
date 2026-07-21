import type { Express, Response } from 'express';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Query,
  ParseUUIDPipe,
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
import { StudiesService } from './studies.service';
import { CreateStudyDto } from './dto/create-study.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { PaginationDto } from './dto/pagination-study.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@ApiTags('studies')
@Controller('studies')
export class StudiesController {
  constructor(private readonly studiesService: StudiesService) {}

  @ApiOperation({ summary: 'Crear estudio', description: 'Crea un nuevo estudio de laboratorio con sus precios por tabulador.' })
  @ApiResponse({ status: 201, description: 'Estudio creado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('studies:create')
  @Post()
  create(@Body() createStudyDto: CreateStudyDto) {
    return this.studiesService.create(createStudyDto);
  }

  @ApiOperation({ summary: 'Listar estudios', description: 'Devuelve el listado paginado de estudios de laboratorio.' })
  @ApiResponse({ status: 200, description: 'Listado paginado de estudios.' })
  @Public()
  @Get()
  findAll(@Query() pagination: PaginationDto) {
    return this.studiesService.findAll(pagination);
  }

  @ApiOperation({ summary: 'Descargar plantilla de importación', description: 'Genera y descarga la plantilla Excel usada para la carga masiva de estudios.' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiResponse({ status: 200, description: 'Archivo Excel de plantilla.' })
  @ApiBearerAuth()
  @Permissions('studies:create')
  @Get('import-template')
  async downloadImportTemplate(@Res() res: Response) {
    const buffer = await this.studiesService.generateImportTemplate();

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="plantilla-carga-estudios.xlsx"',
    );

    res.send(buffer);
  }

  @ApiOperation({ summary: 'Obtener estudio', description: 'Devuelve un estudio por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiResponse({ status: 200, description: 'Estudio encontrado.' })
  @ApiResponse({ status: 404, description: 'Estudio no encontrado.' })
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.studiesService.findOne(id);
  }

  @ApiOperation({ summary: 'Actualizar estudio', description: 'Actualiza los datos de un estudio existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiResponse({ status: 200, description: 'Estudio actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Estudio no encontrado.' })
  @ApiBearerAuth()
  @Permissions('studies:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateStudyDto: UpdateStudyDto,
  ) {
    return this.studiesService.update(id, updateStudyDto);
  }

  @ApiOperation({ summary: 'Eliminar estudio', description: 'Elimina un estudio existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiResponse({ status: 200, description: 'Estudio eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Estudio no encontrado.' })
  @ApiBearerAuth()
  @Permissions('studies:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.studiesService.remove(id);
  }

  @ApiOperation({ summary: 'Importar estudios desde Excel', description: 'Procesa un archivo .xlsx/.xls para crear o actualizar estudios de forma masiva, en lotes de 100 registros.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Archivo Excel (.xlsx o .xls) con los estudios a importar.',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Resultado de la importación con el detalle de éxitos y errores por fila.' })
  @ApiResponse({ status: 400, description: 'Archivo no proporcionado o de tipo inválido.' })
  @ApiBearerAuth()
  @Permissions('studies:create')
  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');

    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];

    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Solo se permite archivo Excel (.xlsx)');
    }
    return this.studiesService.importFromExcel(file.buffer);
  }
}
