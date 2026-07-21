import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PaginationPostDto } from './dto/pagination-post.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) { }

  @ApiOperation({ summary: 'Crear publicación', description: 'Crea una nueva publicación de blog.' })
  @ApiResponse({ status: 201, description: 'Publicación creada exitosamente.' })
  @ApiBearerAuth()
  @Permissions('posts:create')
  @Post()
  create(@Body() createPostDto: CreatePostDto) {
    return this.postsService.create(createPostDto);
  }

  @ApiOperation({ summary: 'Listar publicaciones', description: 'Devuelve el listado paginado de publicaciones del blog.' })
  @ApiResponse({ status: 200, description: 'Listado paginado de publicaciones.' })
  @Public()
  @Get()
  findAll(@Query() PaginationPostDto: PaginationPostDto) {
    return this.postsService.findAll(PaginationPostDto);
  }

  @ApiOperation({ summary: 'Obtener publicación', description: 'Devuelve una publicación por su identificador o slug.' })
  @ApiParam({ name: 'id', description: 'Identificador o slug de la publicación.' })
  @ApiResponse({ status: 200, description: 'Publicación encontrada.' })
  @ApiResponse({ status: 404, description: 'Publicación no encontrada.' })
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.postsService.findOne(id);
  }

  @ApiOperation({ summary: 'Actualizar publicación', description: 'Actualiza los datos de una publicación existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) de la publicación.' })
  @ApiResponse({ status: 200, description: 'Publicación actualizada exitosamente.' })
  @ApiResponse({ status: 404, description: 'Publicación no encontrada.' })
  @ApiBearerAuth()
  @Permissions('posts:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePostDto: UpdatePostDto
  ) {
    return this.postsService.update(id, updatePostDto);
  }

  @ApiOperation({ summary: 'Eliminar publicación', description: 'Elimina una publicación existente.' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) de la publicación.' })
  @ApiResponse({ status: 200, description: 'Publicación eliminada exitosamente.' })
  @ApiResponse({ status: 404, description: 'Publicación no encontrada.' })
  @ApiBearerAuth()
  @Permissions('posts:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.postsService.remove(id);
  }
}
