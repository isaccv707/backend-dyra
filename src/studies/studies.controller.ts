import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { StudiesService } from './studies.service';
import { CreateStudyDto } from './dto/create-study.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { AssignPriceSheetDto } from './dto/assign-price-sheet.dto';
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

  @ApiOperation({ summary: 'Listar estudios', description: 'Devuelve el listado paginado de estudios de laboratorio. Cada estudio pertenece a una sola sucursal; usa branchId para filtrar los de esa sucursal.' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Identificador de sucursal para filtrar estudios.' })
  @ApiResponse({ status: 200, description: 'Listado paginado de estudios.' })
  @Public()
  @Get()
  findAll(@Query() pagination: PaginationDto) {
    return this.studiesService.findAll(pagination);
  }

  @ApiOperation({ summary: 'Obtener estudio', description: 'Devuelve un estudio por su identificador o slug. Al buscar por slug, envía branchId para evitar coincidencias de otra sucursal.' })
  @ApiParam({ name: 'id', description: 'Identificador o slug del estudio.' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Identificador de sucursal, recomendado al buscar por slug.' })
  @ApiResponse({ status: 200, description: 'Estudio encontrado.' })
  @ApiResponse({ status: 404, description: 'Estudio no encontrado.' })
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string, @Query('branchId') branchId?: string) {
    return this.studiesService.findOne(id, branchId);
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

  @ApiOperation({ summary: 'Asignar tarifario a un estudio', description: 'Crea o actualiza el precio de un estudio para un tarifario (price sheet) específico.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiResponse({ status: 200, description: 'Tarifario asignado/actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Estudio o tarifario no encontrado.' })
  @ApiBearerAuth()
  @Permissions('studies:update')
  @Post(':id/price-sheets')
  assignPriceSheet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() assignPriceSheetDto: AssignPriceSheetDto,
  ) {
    return this.studiesService.assignPriceSheet(id, assignPriceSheetDto);
  }

  @ApiOperation({ summary: 'Quitar tarifario de un estudio', description: 'Elimina la asignación de precio de un estudio para un tarifario específico.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del estudio.' })
  @ApiParam({ name: 'priceSheetId', description: 'Identificador (UUID) del tarifario.' })
  @ApiResponse({ status: 200, description: 'Asignación eliminada exitosamente.' })
  @ApiResponse({ status: 404, description: 'El estudio no tiene precio asignado para ese tarifario.' })
  @ApiBearerAuth()
  @Permissions('studies:update')
  @Delete(':id/price-sheets/:priceSheetId')
  removePriceSheet(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('priceSheetId', ParseUUIDPipe) priceSheetId: string,
  ) {
    return this.studiesService.removePriceSheet(id, priceSheetId);
  }
}
