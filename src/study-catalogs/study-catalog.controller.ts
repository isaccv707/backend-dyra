import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Type,
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
import { CreateStudyCatalogDto } from './dto/create-study-catalog.dto';
import { UpdateStudyCatalogDto } from './dto/update-study-catalog.dto';
import { FindStudyCatalogsDto } from './dto/find-study-catalogs.dto';
import {
  SampleTypesService,
  StudySectionsService,
  StudyTechniquesService,
} from './study-catalog.service';

type CatalogService =
  StudySectionsService | SampleTypesService | StudyTechniquesService;

// Genera un controller CRUD idéntico para cada catálogo; `route` es también
// el prefijo de permisos (`<route>:create/read/update/delete`).
function createStudyCatalogController(
  route: string,
  serviceClass: Type<CatalogService>,
  singular: string,
  plural: string,
) {
  @ApiTags(route)
  @ApiBearerAuth()
  @Controller(route)
  class StudyCatalogController {
    constructor(readonly service: CatalogService) {}

    @ApiOperation({
      summary: `Crear ${singular}`,
      description: `Crea un registro del catálogo de ${plural} en una sucursal. El nombre es único por sucursal (sin distinguir mayúsculas).`,
    })
    @ApiResponse({ status: 201, description: 'Registro creado.' })
    @ApiResponse({ status: 409, description: 'El nombre ya existe.' })
    @Permissions(`${route}:create`)
    @Post()
    create(
      @Body() dto: CreateStudyCatalogDto,
      @CurrentUser() user: BranchScopedUser,
    ) {
      return this.service.create(dto, user);
    }

    @ApiOperation({
      summary: `Listar ${plural}`,
      description: `Listado paginado del catálogo de ${plural}, con alcance según las sucursales del usuario. Cada registro trae _count.studies. Usa isActive=true para llenar selects.`,
    })
    @ApiResponse({ status: 200, description: 'Listado paginado.' })
    @Permissions(`${route}:read`)
    @Get()
    findAll(
      @Query() dto: FindStudyCatalogsDto,
      @CurrentUser() user: BranchScopedUser,
    ) {
      return this.service.findAll(dto, user);
    }

    @ApiOperation({ summary: `Obtener ${singular}` })
    @ApiParam({ name: 'id', description: 'Identificador numérico.' })
    @ApiResponse({ status: 200, description: 'Registro encontrado.' })
    @ApiResponse({ status: 404, description: 'Registro no encontrado.' })
    @Permissions(`${route}:read`)
    @Get(':id')
    findOne(
      @Param('id', ParseIntPipe) id: number,
      @CurrentUser() user: BranchScopedUser,
    ) {
      return this.service.findOne(id, user);
    }

    @ApiOperation({
      summary: `Actualizar ${singular}`,
      description:
        'Actualiza nombre y/o isActive. La sucursal no se puede cambiar.',
    })
    @ApiParam({ name: 'id', description: 'Identificador numérico.' })
    @ApiResponse({ status: 200, description: 'Registro actualizado.' })
    @ApiResponse({ status: 404, description: 'Registro no encontrado.' })
    @ApiResponse({ status: 409, description: 'El nombre ya existe.' })
    @Permissions(`${route}:update`)
    @Patch(':id')
    update(
      @Param('id', ParseIntPipe) id: number,
      @Body() dto: UpdateStudyCatalogDto,
      @CurrentUser() user: BranchScopedUser,
    ) {
      return this.service.update(id, dto, user);
    }

    @ApiOperation({
      summary: `Eliminar ${singular}`,
      description:
        'Elimina el registro. Si algún estudio lo usa, se rechaza (409): desactívalo con isActive = false.',
    })
    @ApiParam({ name: 'id', description: 'Identificador numérico.' })
    @ApiResponse({ status: 200, description: 'Registro eliminado.' })
    @ApiResponse({ status: 404, description: 'Registro no encontrado.' })
    @ApiResponse({ status: 409, description: 'El registro está en uso.' })
    @Permissions(`${route}:delete`)
    @Delete(':id')
    remove(
      @Param('id', ParseIntPipe) id: number,
      @CurrentUser() user: BranchScopedUser,
    ) {
      return this.service.remove(id, user);
    }
  }

  // Nest resuelve la dependencia por el tipo declarado en el constructor;
  // aquí se fija explícitamente al servicio de este catálogo.
  Reflect.defineMetadata(
    'design:paramtypes',
    [serviceClass],
    StudyCatalogController,
  );
  Object.defineProperty(StudyCatalogController, 'name', {
    value: `${serviceClass.name.replace('Service', '')}Controller`,
  });

  return StudyCatalogController;
}

export const StudySectionsController = createStudyCatalogController(
  'study-sections',
  StudySectionsService,
  'sección',
  'secciones',
);

export const SampleTypesController = createStudyCatalogController(
  'sample-types',
  SampleTypesService,
  'tipo de muestra',
  'tipos de muestra',
);

export const StudyTechniquesController = createStudyCatalogController(
  'study-techniques',
  StudyTechniquesService,
  'técnica',
  'técnicas',
);
