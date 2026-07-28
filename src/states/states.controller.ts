import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StatesService } from './states.service';
import { CreateStateDto } from './dto/create-state.dto';
import { UpdateStateDto } from './dto/update-state.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@ApiTags('states')
@Controller('states')
export class StatesController {
  constructor(private readonly statesService: StatesService) {}

  @ApiOperation({ summary: 'Crear estado', description: 'Crea un nuevo estado (entidad federativa).' })
  @ApiResponse({ status: 201, description: 'Estado creado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('states:create')
  @Post()
  create(@Body() createStateDto: CreateStateDto) {
    return this.statesService.create(createStateDto);
  }

  @ApiOperation({ summary: 'Listar estados', description: 'Devuelve todos los estados disponibles.' })
  @ApiResponse({ status: 200, description: 'Listado de estados.' })
  @Public()
  @Get()
  findAll() {
    return this.statesService.findAll();
  }

  @ApiOperation({ summary: 'Obtener estado', description: 'Devuelve un estado por su identificador.' })
  @ApiParam({ name: 'id', type: Number, description: 'Identificador numérico del estado.' })
  @ApiResponse({ status: 200, description: 'Estado encontrado.' })
  @ApiResponse({ status: 404, description: 'Estado no encontrado.' })
  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.statesService.findOne(id);
  }

  @ApiOperation({ summary: 'Actualizar estado', description: 'Actualiza los datos de un estado existente.' })
  @ApiParam({ name: 'id', type: Number, description: 'Identificador numérico del estado.' })
  @ApiResponse({ status: 200, description: 'Estado actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Estado no encontrado.' })
  @ApiBearerAuth()
  @Permissions('states:update')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateStateDto: UpdateStateDto) {
    return this.statesService.update(id, updateStateDto);
  }

  @ApiOperation({ summary: 'Eliminar estado', description: 'Elimina un estado existente.' })
  @ApiParam({ name: 'id', type: Number, description: 'Identificador numérico del estado.' })
  @ApiResponse({ status: 200, description: 'Estado eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Estado no encontrado.' })
  @ApiBearerAuth()
  @Permissions('states:delete')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.statesService.remove(id);
  }
}
