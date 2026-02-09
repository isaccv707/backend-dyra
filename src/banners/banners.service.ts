import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { v4 as uuid } from 'uuid';
import { BannerPlacement } from '@prisma/client';

@Injectable()
export class BannersService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }

  findOne(id: string) {
    return this.prisma.banner.findUnique({
      where: { id }
    })
  }

  findAll() {
    return this.prisma.banner.findMany();
  }

  create(dto: CreateBannerDto) {
    const placement = dto.placement ?? BannerPlacement.HOME
    const order = dto.order ?? 0;
    const isActive = dto.isActive ?? true;
    const startAt = dto.startAt ? new Date(dto.startAt) : null;
    const endAt = dto.endAt ? new Date(dto.endAt) : null;

    if (startAt && Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('Invalid startAt date');
    }

    if (endAt && Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Invalid endAt date');
    }

    if (startAt && endAt && startAt >= endAt) {
      throw new BadRequestException("startAt must be before endAt");
    }

    const imageUrl = dto.imageUrl.trim();
    const id = uuid();

    return this.prisma.banner.create({
      data: {
        id,
        placement,
        imageUrl,
        order,
        isActive,
        startAt,
        endAt
      },
      select: {
        id: true,
        placement: true,
        imageUrl: true,
        order: true,
        isActive: true,
        startAt: true,
        endAt: true,
      }
    })
  }
}
