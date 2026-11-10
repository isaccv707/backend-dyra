import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseEnumPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { BannerPlacement } from '@prisma/client';
import { Public } from 'src/auth/decorators/public.decorator';
import {
  AnyPermissions,
  Permissions,
} from 'src/auth/decorators/permissions.decorator';
import { CloudinaryService } from 'src/common/cloudinary/cloudinary.service';

@ApiTags('banners')
@Controller('banners')
export class BannersController {
  constructor(
    private readonly bannersService: BannersService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @ApiOperation({
    summary: 'Solicitar firma de subida de imagen a Cloudinary',
    description:
      'Genera los parámetros firmados para que el admin suba una imagen pública directo a ' +
      'POST https://api.cloudinary.com/v1_1/{cloudName}/image/upload (type upload, carpeta banners/, ' +
      'formatos jpg/jpeg/png/webp). El secure_url resultante se manda después en el payload de creación/edición.',
  })
  @ApiResponse({ status: 201, description: 'Parámetros firmados generados.' })
  @ApiBearerAuth()
  @AnyPermissions('banners:create', 'banners:update')
  @Post('upload-signature')
  createImageUploadSignature() {
    return this.cloudinaryService.generateSignedImageUploadParams('banners');
  }

  @ApiOperation({
    summary: 'Listar banners activos',
    description:
      'Devuelve los banners activos de una sucursal para un tipo de ubicación (placement).',
  })
  @ApiParam({
    name: 'placement',
    enum: BannerPlacement,
    description: 'Ubicación del banner dentro del sitio.',
  })
  @ApiQuery({
    name: 'branchId',
    required: true,
    description: 'Identificador de sucursal cuyos banners se van a mostrar.',
  })
  @ApiResponse({ status: 200, description: 'Listado de banners activos.' })
  @Public()
  @Get('active/:placement')
  findActiveBanners(
    @Param('placement', new ParseEnumPipe(BannerPlacement))
    placement: BannerPlacement,
    @Query('branchId') branchId: string,
  ) {
    return this.bannersService.findActiveBanners(placement, branchId);
  }

  @ApiOperation({
    summary: 'Obtener banner',
    description: 'Devuelve un banner por su identificador.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del banner.' })
  @ApiResponse({ status: 200, description: 'Banner encontrado.' })
  @ApiResponse({ status: 404, description: 'Banner no encontrado.' })
  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bannersService.findOne(id);
  }

  @ApiOperation({
    summary: 'Listar banners',
    description:
      'Devuelve todos los banners, opcionalmente filtrados por sucursal.',
  })
  @ApiQuery({
    name: 'branchId',
    required: false,
    description: 'Identificador de sucursal para filtrar banners.',
  })
  @ApiResponse({ status: 200, description: 'Listado de banners.' })
  @Public()
  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.bannersService.findAll(branchId);
  }

  @ApiOperation({
    summary: 'Crear banner',
    description: 'Crea un nuevo banner.',
  })
  @ApiResponse({ status: 201, description: 'Banner creado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('banners:create')
  @Post()
  create(@Body() createBannerDto: CreateBannerDto) {
    return this.bannersService.create(createBannerDto);
  }

  @ApiOperation({
    summary: 'Actualizar banner',
    description: 'Actualiza los datos de un banner existente.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del banner.' })
  @ApiResponse({ status: 200, description: 'Banner actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Banner no encontrado.' })
  @ApiBearerAuth()
  @Permissions('banners:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateBannerDto: UpdateBannerDto,
  ) {
    return this.bannersService.update(id, updateBannerDto);
  }

  @ApiOperation({
    summary: 'Eliminar banner',
    description: 'Elimina un banner existente.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID) del banner.' })
  @ApiResponse({ status: 200, description: 'Banner eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Banner no encontrado.' })
  @ApiBearerAuth()
  @Permissions('banners:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.bannersService.remove(id);
  }
}
