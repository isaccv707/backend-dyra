import { Injectable } from '@nestjs/common';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { Review } from '@prisma/client';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) { }

  create(createReviewDto: CreateReviewDto): Promise<Review> {
    return this.prisma.review.create({
      data: createReviewDto,
    })
  }

  async findAll(): Promise<Review[]> {
    return await this.prisma.review.findMany(
      { orderBy: { createdAt: 'desc' } }
    );
  }

  async findAllApproved(): Promise<Review[]> {
    return await this.prisma.review.findMany({
      where: { isApproved: true },
      orderBy: { createdAt: 'desc' }
    })
  }

  async approveReview(id: number, updateReviewDto: UpdateReviewDto) {
    try {
      return await this.prisma.review.update({
        where: { id },
        data: updateReviewDto
      });
    } catch (error) {
      handleDatabaseErrors(error, "Review")
    }
  }

  async remove(id: number) {
    try {
      return await this.prisma.review.delete({
        where: { id },
      });
    } catch (error) {
      console.log(error);
      handleDatabaseErrors(error, "Review");
    }
  }
}
