import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PriceSheetsService } from './price-sheets.service';
import { CreatePriceSheetDto } from './dto/create-price-sheet.dto';
import { UpdatePriceSheetDto } from './dto/update-price-sheet.dto';
import { PaginationPriceSheetDto } from './dto/pagination-price-sheet.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

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

  @ApiOperation({ summary: 'Listar tabuladores', description: 'Devuelve todos los tabuladores de precios.' })
  @ApiResponse({ status: 200, description: 'Listado de tabuladores.' })
  @Public()
  @Get()
  findAll() {
    return this.priceSheetsService.findAll();
  }

  @ApiOperation({ summary: 'Obtener tabulador', description: 'Devuelve un tabulador de precios por su identificador, con sus estudios de forma paginada.' })
  @ApiParam({ name: 'id', description: 'Identificador del tabulador.' })
  @ApiResponse({ status: 200, description: 'Tabulador encontrado.' })
  @ApiResponse({ status: 404, description: 'Tabulador no encontrado.' })
  @Public()
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query() paginationPriceSheetDto: PaginationPriceSheetDto,
  ) {
    return this.priceSheetsService.findOne(id, paginationPriceSheetDto);
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
}
