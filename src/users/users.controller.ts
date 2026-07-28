import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginatedQueryDto } from '../common/dto/paginated-query.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Crear usuario', description: 'Crea un nuevo usuario del sistema.' })
  @ApiResponse({ status: 201, description: 'Usuario creado exitosamente.' })
  @Permissions('users:create')
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @ApiOperation({ summary: 'Listar usuarios (paginado)', description: 'Devuelve el listado de usuarios de forma paginada mediante filtros enviados en el cuerpo de la petición.' })
  @ApiResponse({ status: 200, description: 'Listado paginado de usuarios.' })
  @Permissions('users:read')
  @Post('query')
  @HttpCode(200)
  findAllPaginated(@Body() dto: PaginatedQueryDto) {
    return this.usersService.findAllPaginated(dto);
  }

  @ApiOperation({ summary: 'Listar usuarios', description: 'Devuelve todos los usuarios del sistema.' })
  @ApiResponse({ status: 200, description: 'Listado de usuarios.' })
  @Permissions('users:read')
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @ApiOperation({ summary: 'Obtener usuario', description: 'Devuelve un usuario por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador del usuario.' })
  @ApiResponse({ status: 200, description: 'Usuario encontrado.' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado.' })
  @Permissions('users:read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @ApiOperation({ summary: 'Actualizar usuario', description: 'Actualiza los datos de un usuario existente.' })
  @ApiParam({ name: 'id', description: 'Identificador del usuario.' })
  @ApiResponse({ status: 200, description: 'Usuario actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado.' })
  @Permissions('users:update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @ApiOperation({ summary: 'Eliminar usuario', description: 'Elimina un usuario existente.' })
  @ApiParam({ name: 'id', description: 'Identificador del usuario.' })
  @ApiResponse({ status: 200, description: 'Usuario eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado.' })
  @Permissions('users:delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
