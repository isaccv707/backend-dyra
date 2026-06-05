import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePriceSheetDto } from './dto/create-price-sheet.dto';
import { UpdatePriceSheetDto } from './dto/update-price-sheet.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';

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

  async findOne(id: string) {
    const priceSheet = await this.prisma.priceSheets.findUnique({
      where: { id },
      include: {
        studyOnPriceSheets: {
          include: {
            study: true,
          },
        },
      },
    });

    if (!priceSheet) {
      throw new NotFoundException(`PriceSheet with id ${id} not found`);
    }

    return priceSheet;
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
