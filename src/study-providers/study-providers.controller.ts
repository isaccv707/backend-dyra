import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { StudyProvidersService } from './study-providers.service';
import { CreateStudyProviderDto } from './dto/create-study-provider.dto';
import { UpdateStudyProviderDto } from './dto/update-study-provider.dto';
import { FindStudyProvidersDto } from './dto/find-study-providers.dto';

@ApiTags('study-providers')
@ApiBearerAuth()
@Controller('study-providers')
export class StudyProvidersController {
  constructor(private readonly service: StudyProvidersService) {}

  @ApiOperation({
    summary: 'Crear maquilador',
    description:
      'Crea un laboratorio externo (maquilador) en una sucursal. El nombre es único por sucursal (sin distinguir mayúsculas).',
  })
  @ApiResponse({ status: 201, description: 'Maquilador creado.' })
  @ApiResponse({ status: 409, description: 'El nombre ya existe.' })
  @Permissions('study-providers:create')
  @Post()
  create(
    @Body() dto: CreateStudyProviderDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.service.create(dto, user);
  }

  @ApiOperation({
    summary: 'Listar maquiladores',
    description:
      'Listado paginado con alcance según las sucursales del usuario. Cada registro trae _count.studies (estudios y perfiles que lo usan). Usa isActive=true para llenar selects.',
  })
  @ApiResponse({ status: 200, description: 'Listado paginado.' })
  @Permissions('study-providers:read')
  @Get()
  findAll(
    @Query() dto: FindStudyProvidersDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.service.findAll(dto, user);
  }

  @ApiOperation({ summary: 'Obtener maquilador' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID).' })
  @ApiResponse({ status: 200, description: 'Maquilador encontrado.' })
  @ApiResponse({ status: 404, description: 'Maquilador no encontrado.' })
  @Permissions('study-providers:read')
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.service.findOne(id, user);
  }

  @ApiOperation({
    summary: 'Actualizar maquilador',
    description:
      'Actualiza nombre y/o isActive. La sucursal no se puede cambiar.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID).' })
  @ApiResponse({ status: 200, description: 'Maquilador actualizado.' })
  @ApiResponse({ status: 404, description: 'Maquilador no encontrado.' })
  @ApiResponse({ status: 409, description: 'El nombre ya existe.' })
  @Permissions('study-providers:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudyProviderDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @ApiOperation({
    summary: 'Eliminar maquilador',
    description:
      'Elimina el maquilador. Si algún estudio o perfil lo usa, se rechaza (409): desactívalo con isActive = false.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID).' })
  @ApiResponse({ status: 200, description: 'Maquilador eliminado.' })
  @ApiResponse({ status: 404, description: 'Maquilador no encontrado.' })
  @ApiResponse({ status: 409, description: 'El maquilador está en uso.' })
  @Permissions('study-providers:delete')
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.service.remove(id, user);
  }
}
