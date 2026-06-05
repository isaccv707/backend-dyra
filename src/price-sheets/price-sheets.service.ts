import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePriceSheetDto } from './dto/create-price-sheet.dto';
import { UpdatePriceSheetDto } from './dto/update-price-sheet.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { PaginationPriceSheetDto } from './dto/pagination-price-sheet.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class PriceSheetsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createPriceSheetDto: CreatePriceSheetDto) {
    try {
      return await this.prisma.priceSheets.create({
        data: createPriceSheetDto,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'PriceSheet');
    }
  }

  async findAll() {
    return await this.prisma.priceSheets.findMany({
      include: {
        studyOnPriceSheets: {
          include: {
            study: true,
          },
        },
      },
    });
  }

  async findOne(id: string, paginationPriceSheetDto: PaginationPriceSheetDto) {
    const { page = 1, limit = 10, search } = paginationPriceSheetDto;
    const skip = (page - 1) * limit;

    const where: Prisma.StudyOnPriceSheetWhereInput = {
      priceSheetId: id,
    };

    if (search) {
      where.study = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [priceSheet, total] = await Promise.all([
      this.prisma.priceSheets.findUnique({
        where: { id },
        include: {
          studyOnPriceSheets: {
            where,
            skip,
            take: limit,
            include: {
              study: true,
            },
          },
        },
      }),
      this.prisma.studyOnPriceSheet.count({
        where,
      }),
    ]);

    if (!priceSheet) {
      throw new NotFoundException(`PriceSheet with id ${id} not found`);
    }

    return {
      ...priceSheet,
      studyOnPriceSheets: {
        data: priceSheet.studyOnPriceSheets,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async update(id: string, updatePriceSheetDto: UpdatePriceSheetDto) {
    try {
      return await this.prisma.priceSheets.update({
        where: { id },
        data: updatePriceSheetDto,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'PriceSheet');
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.priceSheets.delete({
        where: { id },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'PriceSheet');
    }
  }
}
