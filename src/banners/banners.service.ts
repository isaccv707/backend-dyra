import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { BannerPlacement, Prisma } from '@prisma/client';
import { branchScopeWhere } from 'src/common/utils/branch-scope.util';

@Injectable()
export class BannersService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }

  async findOne(id: string) {
    const banner = await this.prisma.banner.findUnique({
      where: { id },
      include: { branches: true },
    });

    if (!banner) throw new NotFoundException(`Banner with id ${id} not found`);

    return banner;
  }

  findAll(branchId?: string) {
    return this.prisma.banner.findMany({
      where: branchScopeWhere(branchId) as Prisma.BannerWhereInput,
      include: { branches: true },
      orderBy: { order: 'asc' },
    });
  }

  async findActiveBanners(placement: BannerPlacement, branchId?: string) {
    const now = new Date();

    return this.prisma.banner.findMany({
      where: {
        isActive: true,
        placement,
        AND: [
          {
            OR: [
              { startAt: null },
              { startAt: { lte: now } },
            ],
          },
          {
            OR: [
              { endAt: null },
              { endAt: { gte: now } },
            ],
          },
          branchScopeWhere(branchId),
        ],
      },
      orderBy: {
        order: 'asc',
      },
    });
  }

  async create(dto: CreateBannerDto) {
    const { branchIds, ...rest } = dto;
    const placement = rest.placement ?? BannerPlacement.HOME;
    const order = rest.order ?? 0;
    const isActive = rest.isActive ?? true;
    const startAt = rest.startAt ? new Date(rest.startAt) : null;
    const endAt = rest.endAt ? new Date(rest.endAt) : null;

    if (startAt && Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('Invalid startAt date');
    }

    if (endAt && Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Invalid endAt date');
    }

    if (startAt && endAt && startAt >= endAt) {
      throw new BadRequestException('startAt must be before endAt');
    }

    const imageUrl = rest.imageUrl.trim();
    const mobileImageUrl = rest.mobileImageUrl?.trim();

    // Logical duplication check
    const existingBanner = await this.prisma.banner.findFirst({
      where: {
        imageUrl,
        mobileImageUrl,
        placement,
      },
    });

    if (existingBanner) {
      throw new ConflictException('A banner with this configuration already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      // Shift others to make room
      await tx.banner.updateMany({
        where: { placement, order: { gte: order } },
        data: { order: { increment: 1 } },
      });

      return tx.banner.create({
        data: {
          placement,
          imageUrl,
          mobileImageUrl,
          order,
          isActive,
          startAt,
          endAt,
          ...(branchIds?.length && {
            branches: { connect: branchIds.map((id) => ({ id })) },
          }),
        },
        include: { branches: true },
      });
    });
  }

  async update(id: string, dto: UpdateBannerDto) {
    const currentBanner = await this.findOne(id);
    const { order: newOrder, placement: newPlacement, branchIds, ...rest } = dto;

    const oldOrder = currentBanner.order;
    const oldPlacement = currentBanner.placement;
    const targetPlacement = newPlacement ?? oldPlacement;

    return this.prisma.$transaction(async (tx) => {
      // Logic for reordering
      if (newOrder !== undefined && (newOrder !== oldOrder || newPlacement !== oldPlacement)) {
        if (newOrder < 0) throw new BadRequestException('Order cannot be less than 0');

        if (newPlacement === undefined || newPlacement === oldPlacement) {
          // Reordering within same placement
          if (newOrder > oldOrder) {
            await tx.banner.updateMany({
              where: {
                placement: oldPlacement,
                order: { gt: oldOrder, lte: newOrder },
              },
              data: { order: { decrement: 1 } },
            });
          } else if (newOrder < oldOrder) {
            await tx.banner.updateMany({
              where: {
                placement: oldPlacement,
                order: { gte: newOrder, lt: oldOrder },
              },
              data: { order: { increment: 1 } },
            });
          }
        } else {
          // Moving between placements
          // 1. Close gap in old placement
          await tx.banner.updateMany({
            where: { placement: oldPlacement, order: { gt: oldOrder } },
            data: { order: { decrement: 1 } },
          });
          // 2. Open space in new placement
          await tx.banner.updateMany({
            where: { placement: targetPlacement, order: { gte: newOrder } },
            data: { order: { increment: 1 } },
          });
        }
      } else if (newPlacement !== undefined && newPlacement !== oldPlacement) {
        // Placement changed but order not specified - move to end or keep same order?
        // Let's assume we keep the order and just close the gap in the old one
        await tx.banner.updateMany({
          where: { placement: oldPlacement, order: { gt: oldOrder } },
          data: { order: { decrement: 1 } },
        });
        // We could shift in the new placement but since order is not provided, 
        // it might conflict or create gaps. For safety, we shift in the new placement too.
        await tx.banner.updateMany({
          where: { placement: targetPlacement, order: { gte: oldOrder } },
          data: { order: { increment: 1 } },
        });
      }

      return tx.banner.update({
        where: { id },
        data: {
          ...rest,
          ...(newOrder !== undefined && { order: newOrder }),
          ...(newPlacement !== undefined && { placement: newPlacement }),
          ...(branchIds !== undefined && {
            branches: { set: branchIds.map((id) => ({ id })) },
          }),
        },
        include: { branches: true },
      });
    });
  }

  async remove(id: string) {
    const banner = await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      await tx.banner.delete({ where: { id } });

      // Close the gap
      await tx.banner.updateMany({
        where: {
          placement: banner.placement,
          order: { gt: banner.order },
        },
        data: { order: { decrement: 1 } },
      });

      return { deleted: true };
    });
  }
}
