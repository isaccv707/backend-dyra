import { Injectable } from '@nestjs/common';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) { }

  create(createReviewDto: CreateReviewDto) {
    return 'This action adds a new review';
  }

  async findAll() {
    return await this.prisma.review.findMany(
      { orderBy: { createdAt: 'desc' } }
    );
  }

  async findAllApproved() {
    return await this.prisma.review.findMany({
      where: { isApproved: true },
      orderBy: { createdAt: 'desc' }
    })
  }

  findOne(id: number) {
    return `This action returns a #${id} review`;
  }

  update(id: number, updateReviewDto: UpdateReviewDto) {
    return `This action updates a #${id} review`;
  }

  remove(id: number) {
    return `This action removes a #${id} review`;
  }
}
