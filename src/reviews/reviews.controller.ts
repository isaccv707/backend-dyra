import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { FindReviewsDto } from './dto/find-reviews.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @ApiOperation({ summary: 'Crear reseña', description: 'Crea una nueva reseña de una sucursal, pendiente de aprobación.' })
  @ApiResponse({ status: 201, description: 'Reseña creada exitosamente.' })
  @Public()
  @Post()
  create(@Body() createReviewDto: CreateReviewDto) {
    return this.reviewsService.create(createReviewDto);
  }

  @ApiOperation({ summary: 'Listar reseñas', description: 'Devuelve todas las reseñas, incluyendo las no aprobadas, con alcance según la sucursal del usuario autenticado.' })
  @ApiResponse({ status: 200, description: 'Listado de reseñas.' })
  @ApiBearerAuth()
  @Permissions('reviews:read')
  @Get()
  findAll(@Query() dto: FindReviewsDto, @CurrentUser() user: BranchScopedUser) {
    return this.reviewsService.findAll(dto, user);
  }

  @ApiOperation({ summary: 'Listar reseñas aprobadas', description: 'Devuelve únicamente las reseñas aprobadas.' })
  @ApiResponse({ status: 200, description: 'Listado de reseñas aprobadas.' })
  @Public()
  @Get('approved')
  findAllApproved(@Query() dto: FindReviewsDto) {
    return this.reviewsService.findAllApproved(dto);
  }

  @ApiOperation({ summary: 'Aprobar/actualizar reseña', description: 'Actualiza el estado de aprobación u otros datos de una reseña.' })
  @ApiParam({ name: 'id', type: Number, description: 'Identificador numérico de la reseña.' })
  @ApiResponse({ status: 200, description: 'Reseña actualizada exitosamente.' })
  @ApiResponse({ status: 404, description: 'Reseña no encontrada.' })
  @ApiBearerAuth()
  @Permissions('reviews:update')
  @Patch(':id')
  approveReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateReviewDto: UpdateReviewDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.reviewsService.approveReview(id, updateReviewDto, user);
  }

  @ApiOperation({ summary: 'Eliminar reseña', description: 'Elimina una reseña existente.' })
  @ApiParam({ name: 'id', type: Number, description: 'Identificador numérico de la reseña.' })
  @ApiResponse({ status: 200, description: 'Reseña eliminada exitosamente.' })
  @ApiResponse({ status: 404, description: 'Reseña no encontrada.' })
  @ApiBearerAuth()
  @Permissions('reviews:delete')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: BranchScopedUser) {
    return this.reviewsService.remove(id, user);
  }
}
