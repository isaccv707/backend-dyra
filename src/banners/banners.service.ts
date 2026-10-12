import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { BannerPlacement } from '@prisma/client';

@Injectable()
export class BannersService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(id: string) {
    const banner = await this.prisma.banner.findUnique({
      where: { id },
      include: { branch: true },
    });

    if (!banner) throw new NotFoundException(`Banner with id ${id} not found`);

    return banner;
  }

  findAll(branchId?: string) {
    return this.prisma.banner.findMany({
      where: { ...(branchId && { branchId }) },
      include: { branch: true },
      orderBy: { order: 'asc' },
    });
  }

  async findActiveBanners(placement: BannerPlacement, branchId: string) {
    if (!branchId) {
      throw new BadRequestException('branchId is required');
    }

    const now = new Date();

    return this.prisma.banner.findMany({
      where: {
        isActive: true,
        placement,
        branchId,
        AND: [
          {
            OR: [{ startAt: null }, { startAt: { lte: now } }],
          },
          {
            OR: [{ endAt: null }, { endAt: { gte: now } }],
          },
        ],
      },
      orderBy: {
        order: 'asc',
      },
    });
  }

  async create(dto: CreateBannerDto) {
    const { branchId, ...rest } = dto;
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

    const existingBanner = await this.prisma.banner.findFirst({
      where: {
        imageUrl,
        mobileImageUrl,
        placement,
        branchId,
      },
    });

    if (existingBanner) {
      throw new ConflictException(
        'A banner with this configuration already exists',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.banner.updateMany({
        where: { branchId, placement, order: { gte: order } },
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
          branch: { connect: { id: branchId } },
        },
        include: { branch: true },
      });
    });
  }

  async update(id: string, dto: UpdateBannerDto) {
    const currentBanner = await this.findOne(id);
    const {
      order: newOrder,
      placement: newPlacement,
      branchId: newBranchId,
      ...rest
    } = dto;

    const oldOrder = currentBanner.order;
    const oldPlacement = currentBanner.placement;
    const oldBranchId = currentBanner.branchId;
    const targetPlacement = newPlacement ?? oldPlacement;
    const targetBranchId = newBranchId ?? oldBranchId;
    const movingQueue =
      targetBranchId !== oldBranchId || targetPlacement !== oldPlacement;

    return this.prisma.$transaction(async (tx) => {
      if (newOrder !== undefined && (newOrder !== oldOrder || movingQueue)) {
        if (newOrder < 0)
          throw new BadRequestException('Order cannot be less than 0');

        if (!movingQueue) {
          if (newOrder > oldOrder) {
            await tx.banner.updateMany({
              where: {
                branchId: oldBranchId,
                placement: oldPlacement,
                order: { gt: oldOrder, lte: newOrder },
              },
              data: { order: { decrement: 1 } },
            });
          } else if (newOrder < oldOrder) {
            await tx.banner.updateMany({
              where: {
                branchId: oldBranchId,
                placement: oldPlacement,
                order: { gte: newOrder, lt: oldOrder },
              },
              data: { order: { increment: 1 } },
            });
          }
        } else {
          await tx.banner.updateMany({
            where: {
              branchId: oldBranchId,
              placement: oldPlacement,
              order: { gt: oldOrder },
            },
            data: { order: { decrement: 1 } },
          });
          await tx.banner.updateMany({
            where: {
              branchId: targetBranchId,
              placement: targetPlacement,
              order: { gte: newOrder },
            },
            data: { order: { increment: 1 } },
          });
        }
      } else if (movingQueue) {
        await tx.banner.updateMany({
          where: {
            branchId: oldBranchId,
            placement: oldPlacement,
            order: { gt: oldOrder },
          },
          data: { order: { decrement: 1 } },
        });
        await tx.banner.updateMany({
          where: {
            branchId: targetBranchId,
            placement: targetPlacement,
            order: { gte: oldOrder },
          },
          data: { order: { increment: 1 } },
        });
      }

      return tx.banner.update({
        where: { id },
        data: {
          ...rest,
          ...(newOrder !== undefined && { order: newOrder }),
          ...(newPlacement !== undefined && { placement: newPlacement }),
          ...(newBranchId && { branch: { connect: { id: newBranchId } } }),
        },
        include: { branch: true },
      });
    });
  }

  async remove(id: string) {
    const banner = await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      await tx.banner.delete({ where: { id } });

      await tx.banner.updateMany({
        where: {
          branchId: banner.branchId,
          placement: banner.placement,
          order: { gt: banner.order },
        },
        data: { order: { decrement: 1 } },
      });

      return { deleted: true };
    });
  }
}
