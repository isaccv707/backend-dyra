import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { FindReviewsDto } from './dto/find-reviews.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { Prisma, Review } from '@prisma/client';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';
import { assertBranchAccess, BranchScopedUser, userBranchFilter } from 'src/common/utils/branch-access.util';

const REVIEW_ALLOWED_FIELDS = ['fullName', 'rating', 'isApproved', 'createdAt'];

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createReviewDto: CreateReviewDto): Promise<Review> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: createReviewDto.branchId },
    });
    if (!branch) {
      throw new NotFoundException(`Branch with ID '${createReviewDto.branchId}' not found`);
    }

    return this.prisma.review.create({
      data: createReviewDto,
    })
  }

  async findAll(dto: FindReviewsDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['fullName'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: REVIEW_ALLOWED_FIELDS,
    });

    const finalWhere = { ...where, ...userBranchFilter(user, dto.branchId) } as Prisma.ReviewWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({ skip, take, where: finalWhere, orderBy }),
      this.prisma.review.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findAllApproved(dto: FindReviewsDto) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['fullName'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: REVIEW_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      isApproved: true,
      ...(dto.branchId && { branchId: dto.branchId }),
    } as Prisma.ReviewWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({ skip, take, where: finalWhere, orderBy }),
      this.prisma.review.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async approveReview(id: number, updateReviewDto: UpdateReviewDto, user: BranchScopedUser) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException(`Review with ID #${id} not found`);
    }
    assertBranchAccess(user, review.branchId);

    try {
      return await this.prisma.review.update({
        where: { id },
        data: updateReviewDto
      });
    } catch (error) {
      handleDatabaseErrors(error, "Review")
    }
  }

  async remove(id: number, user: BranchScopedUser) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException(`Review with ID #${id} not found`);
    }
    assertBranchAccess(user, review.branchId);

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
