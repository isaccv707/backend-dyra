import type { Express, Response } from 'express';
import {
  Controller,
  Get,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { assertExcelFile } from 'src/common/utils/excel-file.util';
import { StudyCatalogImportService } from './study-catalog-import.service';

const CATALOG_CREATE_PERMISSIONS = [
  'study-sections:create',
  'sample-types:create',
  'study-techniques:create',
];

@ApiTags('study-catalogs')
@ApiBearerAuth()
@Controller('study-catalogs')
export class StudyCatalogImportController {
  constructor(private readonly catalogImport: StudyCatalogImportService) {}

  @ApiOperation({
    summary: 'Descargar plantilla de importación de catálogos',
    description:
      'Genera la plantilla Excel con una hoja por catálogo (Secciones, Tipos de muestra, Técnicas) y las columnas name e isActive.',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiResponse({ status: 200, description: 'Archivo Excel de plantilla.' })
  @Permissions(...CATALOG_CREATE_PERMISSIONS)
  @Get('import-template')
  downloadImportTemplate(@Res() res: Response) {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="plantilla-catalogos-estudios.xlsx"',
    );
    res.send(this.catalogImport.generateTemplate());
  }

  @ApiOperation({
    summary: 'Importar catálogos de estudios desde Excel',
    description:
      'Crea secciones, tipos de muestra y técnicas en una sucursal desde un .xlsx/.xls con una hoja por catálogo (Secciones, Tipos de muestra, Técnicas; las hojas son opcionales y sin distinguir mayúsculas ni acentos). Columnas: name (obligatoria) e isActive (opcional, por defecto true). Solo crea: un nombre que ya existe en la sucursal (sin distinguir mayúsculas) se omite y no se modifica.',
  })
  @ApiQuery({
    name: 'branchId',
    required: true,
    description: 'Identificador de la sucursal destino.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Archivo Excel (.xlsx o .xls) con los catálogos.',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Resultado por catálogo: creados, omitidos (ya existían) y filas inválidas.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Archivo no proporcionado, de tipo inválido, sin hojas reconocidas o sin columna name.',
  })
  @ApiResponse({ status: 404, description: 'Sucursal no encontrada.' })
  @Permissions(...CATALOG_CREATE_PERMISSIONS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @Query('branchId', ParseUUIDPipe) branchId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: BranchScopedUser,
  ) {
    assertExcelFile(file);
    await this.catalogImport.assertImportableBranch(branchId, user);
    return this.catalogImport.importCatalogs(branchId, file.buffer);
  }
}
