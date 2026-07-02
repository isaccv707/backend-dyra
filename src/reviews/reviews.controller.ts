import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Query } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { FindReviewsDto } from './dto/find-reviews.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) { }

  @Public()
  @Post()
  create(@Body() createReviewDto: CreateReviewDto) {
    return this.reviewsService.create(createReviewDto);
  }

  @Permissions('reviews:read')
  @Get()
  findAll(@Query() dto: FindReviewsDto) {
    return this.reviewsService.findAll(dto);
  }

  @Public()
  @Get('approved')
  findAllApproved(@Query() dto: FindReviewsDto) {
    return this.reviewsService.findAllApproved(dto);
  }

  @Permissions('reviews:update')
  @Patch(':id')
  approveReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateReviewDto: UpdateReviewDto
  ) {
    return this.reviewsService.approveReview(id, updateReviewDto);
  }

  @Permissions('reviews:delete')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.reviewsService.remove(id)
  }

}
