import { Controller, Get, Post, Body, Query, Param, Delete, Patch, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthorsService } from './authors.service';
import { CreateAuthorDto } from './dto/create-author.dto';
import { PaginationAuthorDto } from './dto/pagination-author.dto';
import { UpdateAuthorDto } from './dto/update-author.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@ApiTags('authors')
@Controller('authors')
export class AuthorsController {
  constructor(private readonly authorsService: AuthorsService) { }

  @ApiOperation({ summary: 'Crear autor', description: 'Crea un nuevo autor de blog.' })
  @ApiResponse({ status: 201, description: 'Autor creado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('authors:create')
  @Post()
  createAuthor(@Body() createAuthorDto: CreateAuthorDto) {
    return this.authorsService.createAuthor(createAuthorDto)
  }

  @ApiOperation({ summary: 'Listar autores', description: 'Devuelve el listado paginado de autores.' })
  @ApiResponse({ status: 200, description: 'Listado paginado de autores.' })
  @Public()
  @Get()
  findAll(@Query() pagination: PaginationAuthorDto) {
    return this.authorsService.findAllAuthors(pagination);
  }

  @ApiOperation({ summary: 'Obtener autor', description: 'Devuelve un autor por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del autor.' })
  @ApiResponse({ status: 200, description: 'Autor encontrado.' })
  @ApiResponse({ status: 404, description: 'Autor no encontrado.' })
  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.authorsService.findOneAuthor(id);
  }

  @ApiOperation({ summary: 'Actualizar autor', description: 'Actualiza los datos de un autor existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del autor.' })
  @ApiResponse({ status: 200, description: 'Autor actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Autor no encontrado.' })
  @ApiBearerAuth()
  @Permissions('authors:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateAuthorDto: UpdateAuthorDto
  ) {
    return this.authorsService.updateAuthor(id, updateAuthorDto)
  }

  @ApiOperation({ summary: 'Eliminar autor', description: 'Elimina un autor existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del autor.' })
  @ApiResponse({ status: 200, description: 'Autor eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Autor no encontrado.' })
  @ApiBearerAuth()
  @Permissions('authors:delete')
  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.authorsService.deleteAuthor(id);
  }
}
