import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@ApiTags('branches')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @ApiOperation({ summary: 'Crear sucursal', description: 'Crea una nueva sucursal, incluyendo su dirección y horarios.' })
  @ApiResponse({ status: 201, description: 'Sucursal creada exitosamente.' })
  @ApiBearerAuth()
  @Permissions('branches:create')
  @Post()
  create(@Body() createBranchDto: CreateBranchDto) {
    return this.branchesService.create(createBranchDto);
  }

  @ApiOperation({ summary: 'Listar sucursales', description: 'Devuelve todas las sucursales disponibles.' })
  @ApiResponse({ status: 200, description: 'Listado de sucursales.' })
  @Public()
  @Get()
  findAll() {
    return this.branchesService.findAll();
  }

  @ApiOperation({ summary: 'Obtener sucursal', description: 'Devuelve una sucursal por su identificador, incluyendo servicios disponibles.' })
  @ApiParam({ name: 'id', description: 'Identificador de la sucursal.' })
  @ApiResponse({ status: 200, description: 'Sucursal encontrada.' })
  @ApiResponse({ status: 404, description: 'Sucursal no encontrada.' })
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.branchesService.findOne(id);
  }

  @ApiOperation({ summary: 'Actualizar sucursal', description: 'Actualiza los datos de una sucursal existente.' })
  @ApiParam({ name: 'id', description: 'Identificador de la sucursal.' })
  @ApiResponse({ status: 200, description: 'Sucursal actualizada exitosamente.' })
  @ApiResponse({ status: 404, description: 'Sucursal no encontrada.' })
  @ApiBearerAuth()
  @Permissions('branches:update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateBranchDto: UpdateBranchDto) {
    return this.branchesService.update(id, updateBranchDto);
  }

  @ApiOperation({ summary: 'Eliminar sucursal', description: 'Elimina una sucursal existente.' })
  @ApiParam({ name: 'id', description: 'Identificador de la sucursal.' })
  @ApiResponse({ status: 200, description: 'Sucursal eliminada exitosamente.' })
  @ApiResponse({ status: 404, description: 'Sucursal no encontrada.' })
  @ApiBearerAuth()
  @Permissions('branches:delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.branchesService.remove(id);
  }
}
