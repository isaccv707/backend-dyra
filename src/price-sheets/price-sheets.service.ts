import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePriceSheetDto } from './dto/create-price-sheet.dto';
import { UpdatePriceSheetDto } from './dto/update-price-sheet.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { PaginationPriceSheetDto } from './dto/pagination-price-sheet.dto';
import { Prisma } from '@prisma/client';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';

const STUDY_ON_PRICE_SHEET_ALLOWED_FIELDS = ['study.name', 'study.code', 'price', 'showPrice'];

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

  async findOne(id: string, dto: PaginationPriceSheetDto) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['study.name', 'study.code'],
      defaultSort: { study: { name: 'asc' } },
      allowedFields: STUDY_ON_PRICE_SHEET_ALLOWED_FIELDS,
    });

    const finalWhere = { ...where, priceSheetId: id } as Prisma.StudyOnPriceSheetWhereInput;

    const [priceSheet, total] = await Promise.all([
      this.prisma.priceSheets.findUnique({
        where: { id },
        include: {
          studyOnPriceSheets: {
            where: finalWhere,
            skip,
            take,
            orderBy,
            include: {
              study: true,
            },
          },
        },
      }),
      this.prisma.studyOnPriceSheet.count({
        where: finalWhere,
      }),
    ]);

    if (!priceSheet) {
      throw new NotFoundException(`PriceSheet with id ${id} not found`);
    }

    return {
      ...priceSheet,
      studyOnPriceSheets: paginatedResponse(
        priceSheet.studyOnPriceSheets,
        total,
        dto.page ?? 1,
        dto.limit ?? 10,
      ),
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
