import type { Express, Response } from 'express';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Put,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { StudiesService } from './studies.service';
import { StudyExcelImportService } from './study-excel-import.service';
import { CreateStudyDto } from './dto/create-study.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { AssignPriceSheetDto } from './dto/assign-price-sheet.dto';
import { PaginationDto } from './dto/pagination-study.dto';
import { SetPanelItemsDto } from './dto/set-panel-items.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { generateSlug } from 'src/common/utils/slugger.util';
import { assertExcelFile } from 'src/common/utils/excel-file.util';

@ApiTags('studies')
@Controller('studies')
export class StudiesController {
  constructor(
    private readonly studiesService: StudiesService,
    private readonly studyExcelImport: StudyExcelImportService,
  ) {}

  @ApiOperation({
    summary: 'Crear estudio',
    description:
      'Crea un nuevo estudio de laboratorio con sus precios por tabulador, pacientes elegibles (eligiblePatients) y valores de referencia (referenceValues). Un estudio sin precios no se oferta. Un perfil (isPanel = true) no puede tener units ni decimals.',
  })
  @ApiResponse({ status: 201, description: 'Estudio creado exitosamente.' })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos: perfil con units/decimals, rango de edad o de valores invertido, catálogo/servicio/tarifario de otra sucursal.',
  })
  @ApiBearerAuth()
  @Permissions('studies:create')
  @Post()
  create(
    @Body() createStudyDto: CreateStudyDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.studiesService.create(createStudyDto, user);
  }

  @ApiOperation({
    summary: 'Listar estudios',
    description:
      'Devuelve el listado paginado de estudios activos. Cada estudio pertenece a una sola sucursal; usa branchId para filtrar los de esa sucursal. Filtros de pacientes elegibles: gender y ageFormat exactos; minAge devuelve estudios cuya edad mínima es >= minAge; maxAge, estudios cuya edad máxima es <= maxAge. sort/filters aceptan eligiblePatients.<campo>. Cada estudio trae priceInfo = { showPrice, price, message }: con branchId, el precio de la lista asignada a su servicio; sin branchId, el de priceSheetId. Solo se usan listas públicas (isPublic) y activas.',
  })
  @ApiQuery({
    name: 'branchId',
    required: false,
    description: 'Identificador de sucursal para filtrar estudios.',
  })
  @ApiQuery({
    name: 'priceSheetId',
    required: false,
    description:
      'Lista de precios pública y activa de la que se toman los precios (solo sin branchId).',
  })
  @ApiResponse({ status: 200, description: 'Listado paginado de estudios.' })
  @ApiResponse({
    status: 404,
    description: 'priceSheetId no existe, no es pública o no está activa.',
  })
  @Public()
  @Get()
  findAll(@Query() pagination: PaginationDto) {
    return this.studiesService.findAll(pagination);
  }

  @ApiOperation({
    summary: 'Listar estudios ordenables',
    description:
      'Devuelve el listado paginado de estudios activos que se pueden ofertar al público: los que tienen al menos un precio en una lista de precios pública (isPublic) y activa. Con priceSheetId solo cuenta un precio en esa lista, que debe ser pública y activa.',
  })
  @ApiQuery({
    name: 'branchId',
    required: false,
    description: 'Identificador de sucursal para filtrar estudios.',
  })
  @ApiQuery({
    name: 'priceSheetId',
    required: false,
    description:
      'Identificador del tarifario (público y activo): solo estudios con precio en ese tarifario.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de estudios ordenables.',
  })
  @ApiResponse({
    status: 404,
    description: 'priceSheetId no existe, no es pública o no está activa.',
  })
  @Public()
  @Get('orderable')
  findOrderable(@Query() pagination: PaginationDto) {
    return this.studiesService.findOrderable(pagination);
  }

  @ApiOperation({
    summary: 'Listar estudios activos (admin)',
    description:
      'Como el listado general, pero limitado a las sucursales del usuario e incluye los datos de maquila (isInternal, providerName, providerCost) y hasConfiguredPrice. Acepta además el filtro isInternal.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de estudios activos.',
  })
  @ApiBearerAuth()
  @Permissions('studies:read')
  @Get('admin')
  findAdminActive(
    @Query() pagination: PaginationDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.studiesService.findAdminActive(pagination, user);
  }

  @ApiOperation({
    summary: 'Listar estudios inactivos',
    description:
      'Devuelve el listado paginado de estudios desactivados (no se muestran en las rutas públicas ni se pueden cotizar). Acepta los mismos filtros que el listado general.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de estudios inactivos.',
  })
  @ApiBearerAuth()
  @Permissions('studies:read')
  @Get('inactive')
  findInactive(
    @Query() pagination: PaginationDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.studiesService.findInactive(pagination, user);
  }

  @ApiOperation({
    summary: 'Obtener estudio inactivo',
    description:
      'Devuelve el detalle de un estudio desactivado, para revisarlo o reactivarlo con PATCH isActive = true.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiResponse({ status: 200, description: 'Estudio encontrado.' })
  @ApiResponse({ status: 404, description: 'Estudio inactivo no encontrado.' })
  @ApiBearerAuth()
  @Permissions('studies:read')
  @Get('inactive/:id')
  findInactiveOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.studiesService.findInactiveOne(id, user);
  }

  @ApiOperation({
    summary: 'Listar estudios ordenables (admin)',
    description:
      'Versión admin de GET /studies/orderable para el wizard de cotización: estudios activos con al menos un precio en una lista de precios activa, pública o privada (de socio), de las sucursales asignadas al usuario. Con priceSheetId solo cuenta un precio en esa lista, que debe estar activa y ser de una sucursal del usuario. priceInfo incluye hasConfiguredPrice.',
  })
  @ApiQuery({
    name: 'branchId',
    required: false,
    description: 'Identificador de sucursal (debe estar asignada al usuario).',
  })
  @ApiQuery({
    name: 'priceSheetId',
    required: false,
    description:
      'Identificador del tarifario (activo, público o privado): solo estudios con precio en ese tarifario.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de estudios ordenables.',
  })
  @ApiResponse({
    status: 403,
    description: 'branchId no está asignada al usuario.',
  })
  @ApiResponse({
    status: 404,
    description:
      'priceSheetId no existe, no está activa o es de una sucursal no asignada al usuario.',
  })
  @ApiBearerAuth()
  @Permissions('studies:read')
  @Get('admin/orderable')
  findAdminOrderable(
    @Query() pagination: PaginationDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.studiesService.findAdminOrderable(pagination, user);
  }

  @ApiOperation({
    summary: 'Obtener estudio (admin)',
    description:
      'Devuelve el detalle completo de un estudio (activo o inactivo) para el panel admin, incluidos sus precios en todas las listas de precios (priceSheets), públicas y privadas.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiResponse({ status: 200, description: 'Estudio encontrado.' })
  @ApiResponse({ status: 404, description: 'Estudio no encontrado.' })
  @ApiBearerAuth()
  @Permissions('studies:read')
  @Get('admin/:id')
  findAdminOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.studiesService.findAdminOne(id, user);
  }

  @ApiOperation({
    summary: 'Obtener estudio por slug',
    description:
      "Devuelve un estudio activo por su slug. El slug solo es único dentro de una sucursal, por eso branchId es obligatorio. No incluye priceSheets; priceInfo = { showPrice, price, message }: precio de la lista de precios asignada al servicio del estudio, solo si es pública (isPublic) y activa; si no hay precio público, showPrice = false, price = null y message = 'Para mayor información consulte en sucursal'.",
  })
  @ApiParam({ name: 'slug', description: 'Slug del estudio.' })
  @ApiQuery({
    name: 'branchId',
    required: true,
    description: 'Identificador de la sucursal del estudio.',
  })
  @ApiResponse({ status: 200, description: 'Estudio encontrado.' })
  @ApiResponse({ status: 404, description: 'Estudio no encontrado.' })
  @Public()
  @Get('by-slug/:slug')
  findBySlug(
    @Param('slug') slug: string,
    @Query('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.studiesService.findBySlug(slug, branchId);
  }

  @ApiOperation({
    summary: 'Exportar estudios de una sucursal',
    description:
      'Genera y descarga un Excel con todos los estudios de una sucursal (activos e inactivos) y toda su información: datos generales (nombre, título, servicio, catálogos, pacientes elegibles, unidades, descripción, preparación), parámetros del perfil, perfiles a los que pertenece, un precio por lista de precios de la sucursal, y una segunda hoja con los valores de referencia.',
  })
  @ApiQuery({
    name: 'branchId',
    required: true,
    description: 'Identificador de la sucursal a exportar.',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiResponse({ status: 200, description: 'Archivo Excel de estudios.' })
  @ApiResponse({ status: 404, description: 'Sucursal no encontrada.' })
  @ApiBearerAuth()
  @Permissions('studies:read')
  @Get('export')
  async exportByBranch(
    @Query('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: BranchScopedUser,
    @Res() res: Response,
  ) {
    const { buffer, branchName } = await this.studiesService.exportByBranch(
      branchId,
      user,
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="estudios-${generateSlug(branchName)}.xlsx"`,
    );

    res.send(buffer);
  }

  @ApiOperation({
    summary: 'Descargar plantilla de importación de estudios',
    description:
      'Genera la plantilla Excel para cargar estudios de forma masiva en una sucursal, sin precios. Incluye una hoja con los servicios activos de la sucursal.',
  })
  @ApiQuery({
    name: 'branchId',
    required: true,
    description: 'Identificador de la sucursal destino.',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiResponse({ status: 200, description: 'Archivo Excel de plantilla.' })
  @ApiResponse({ status: 404, description: 'Sucursal no encontrada.' })
  @ApiBearerAuth()
  @Permissions('studies:create')
  @Get('import-template')
  async downloadImportTemplate(
    @Query('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: BranchScopedUser,
    @Res() res: Response,
  ) {
    await this.studyExcelImport.assertImportableBranch(branchId, user);
    const buffer = await this.studyExcelImport.generateTemplate(branchId, {
      withPrice: false,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="plantilla-estudios.xlsx"',
    );

    res.send(buffer);
  }

  @ApiOperation({
    summary: 'Importar estudios desde Excel',
    description:
      'Crea o actualiza (por code) los estudios de una sucursal desde un .xlsx/.xls, sin asignar precios: útil para parámetros que solo existen dentro de perfiles. Una fila con price o showPrice capturado se rechaza (para precios usa POST /price-sheets/:id/import-excel). section y sampleType son obligatorias en estudios nuevos y technique es opcional; las tres se crean en el catálogo si no existen. La columna parametros (códigos separados por coma, solo con isPanel = true) reemplaza los hijos del perfil. No importa valores de referencia.',
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
          description: 'Archivo Excel (.xlsx o .xls) con los estudios.',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Resultado de la importación con el detalle de éxitos y errores por fila.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Archivo no proporcionado, de tipo inválido o sin columnas obligatorias.',
  })
  @ApiResponse({ status: 404, description: 'Sucursal no encontrada.' })
  @ApiBearerAuth()
  @Permissions('studies:create')
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @Query('branchId', ParseUUIDPipe) branchId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: BranchScopedUser,
  ) {
    assertExcelFile(file);
    await this.studyExcelImport.assertImportableBranch(branchId, user);
    return this.studyExcelImport.importStudies(branchId, file.buffer);
  }

  @ApiOperation({
    summary: 'Obtener estudio',
    description:
      "Devuelve un estudio activo por su identificador. Para buscar por slug usa GET /studies/by-slug/:slug?branchId=. No incluye priceSheets (el detalle con todas las listas está en GET /studies/admin/:id); priceInfo = { showPrice, price, message }: precio de la lista de precios asignada al servicio del estudio, solo si es pública (isPublic) y activa; si no hay precio público, showPrice = false, price = null y message = 'Para mayor información consulte en sucursal'.",
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiResponse({ status: 200, description: 'Estudio encontrado.' })
  @ApiResponse({ status: 404, description: 'Estudio no encontrado.' })
  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.studiesService.findOne(id);
  }

  @ApiOperation({
    summary: 'Árbol de un perfil',
    description:
      'Devuelve los estudios hijos de un perfil, con los sub-perfiles expandidos recursivamente. Para un estudio que no es perfil, children es [].',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiResponse({ status: 200, description: 'Árbol del perfil.' })
  @ApiResponse({ status: 404, description: 'Estudio no encontrado.' })
  @Public()
  @Get(':id/panel-tree')
  getPanelTree(@Param('id', ParseUUIDPipe) id: string) {
    return this.studiesService.getPanelTree(id);
  }

  @ApiOperation({
    summary: 'Definir estudios de un perfil',
    description:
      'Reemplaza la lista completa de estudios hijos de un perfil (isPanel = true). Los hijos deben ser de la misma sucursal, pueden ser a su vez perfiles, y no se permiten ciclos. Enviar items: [] deja el perfil vacío.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del perfil.' })
  @ApiResponse({ status: 200, description: 'Lista de hijos actualizada.' })
  @ApiResponse({
    status: 400,
    description:
      'El estudio no es perfil, hay hijos repetidos/de otra sucursal, o se forma un ciclo.',
  })
  @ApiResponse({ status: 404, description: 'Estudio no encontrado.' })
  @ApiBearerAuth()
  @Permissions('studies:update')
  @Put(':id/panel-items')
  setPanelItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPanelItemsDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.studiesService.setPanelItems(id, dto, user);
  }

  @ApiOperation({
    summary: 'Actualizar estudio',
    description:
      'Actualiza los datos de un estudio existente. Cambiar name no cambia el slug: envía slug explícitamente para cambiarlo. Si se envía referenceValues, reemplaza la lista completa ([] la vacía). Al marcarlo como perfil se limpian units y decimals. isActive = true reactiva un estudio desactivado.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiResponse({
    status: 200,
    description: 'Estudio actualizado exitosamente.',
  })
  @ApiResponse({ status: 404, description: 'Estudio no encontrado.' })
  @ApiBearerAuth()
  @Permissions('studies:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateStudyDto: UpdateStudyDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.studiesService.update(id, updateStudyDto, user);
  }

  @ApiOperation({
    summary: 'Desactivar estudio',
    description:
      'Desactiva el estudio (isActive = false): deja de mostrarse en las rutas públicas y no se puede cotizar. Se rechaza si el estudio forma parte de algún perfil. Conserva precios y valores de referencia; se reactiva con PATCH isActive = true.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiResponse({ status: 200, description: 'Estudio desactivado.' })
  @ApiResponse({ status: 404, description: 'Estudio no encontrado.' })
  @ApiBearerAuth()
  @Permissions('studies:delete')
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.studiesService.remove(id, user);
  }

  @ApiOperation({
    summary: 'Asignar tarifario a un estudio',
    description:
      'Crea o actualiza el precio de un estudio en una lista de precios (price sheet). El precio no puede ser negativo.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiResponse({
    status: 200,
    description: 'Tarifario asignado/actualizado exitosamente.',
  })
  @ApiResponse({
    status: 404,
    description: 'Estudio o tarifario no encontrado.',
  })
  @ApiBearerAuth()
  @Permissions('studies:update')
  @Post(':id/price-sheets')
  assignPriceSheet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() assignPriceSheetDto: AssignPriceSheetDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.studiesService.assignPriceSheet(id, assignPriceSheetDto, user);
  }

  @ApiOperation({
    summary: 'Quitar tarifario de un estudio',
    description:
      'Elimina la asignación de precio de un estudio para un tarifario específico.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiParam({
    name: 'priceSheetId',
    description: 'Identificador (UUID) del tarifario.',
  })
  @ApiResponse({
    status: 200,
    description: 'Asignación eliminada exitosamente.',
  })
  @ApiResponse({
    status: 404,
    description: 'El estudio no tiene precio asignado para ese tarifario.',
  })
  @ApiBearerAuth()
  @Permissions('studies:update')
  @Delete(':id/price-sheets/:priceSheetId')
  removePriceSheet(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('priceSheetId', ParseUUIDPipe) priceSheetId: string,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.studiesService.removePriceSheet(id, priceSheetId, user);
  }
}
