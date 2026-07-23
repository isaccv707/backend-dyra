import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreatePriceSheetDto } from './dto/create-price-sheet.dto';
import { UpdatePriceSheetDto } from './dto/update-price-sheet.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { PaginationPriceSheetDto } from './dto/pagination-price-sheet.dto';
import { FindPriceSheetsDto } from './dto/find-price-sheets.dto';
import { Prisma } from '@prisma/client';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import {
  assertBranchAccess,
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';

const STUDY_ON_PRICE_SHEET_ALLOWED_FIELDS = [
  'study.name',
  'study.code',
  'price',
  'showPrice',
];
const PRICE_SHEET_ALLOWED_FIELDS = [
  'name',
  'description',
  'isActive',
  'isPublic',
  'branch.name',
];

@Injectable()
export class PriceSheetsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createPriceSheetDto: CreatePriceSheetDto) {
    const { branchId, isPublic, ...rest } = createPriceSheetDto;

    if (isPublic) {
      const existingPublic = await this.prisma.priceSheets.findFirst({
        where: { branchId, isPublic: true },
        select: { id: true, name: true },
      });

      if (existingPublic) {
        throw new ConflictException(
          `La sucursal ya tiene una hoja de precios pública ("${existingPublic.name}"). Actualízala para quitarle el estado público, o usa PATCH sobre esa hoja para reemplazarla, antes de crear una nueva como pública.`,
        );
      }
    }

    try {
      return await this.prisma.priceSheets.create({
        data: {
          ...rest,
          isPublic: !!isPublic,
          branch: { connect: { id: branchId } },
        },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'PriceSheet');
    }
  }

  async findAll(dto: FindPriceSheetsDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'description', 'branch.name'],
      defaultSort: { name: 'asc' },
      allowedFields: PRICE_SHEET_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
    } as Prisma.PriceSheetsWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.priceSheets.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: {
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.priceSheets.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(
    id: string,
    dto: PaginationPriceSheetDto,
    user: BranchScopedUser,
  ) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['study.name', 'study.code'],
      defaultSort: { study: { name: 'asc' } },
      allowedFields: STUDY_ON_PRICE_SHEET_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      priceSheetId: id,
    } as Prisma.StudyOnPriceSheetWhereInput;

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

    assertBranchAccess(user, priceSheet.branchId);

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
    const { branchId, isPublic, ...rest } = updatePriceSheetDto;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (isPublic) {
          const current = await tx.priceSheets.findUniqueOrThrow({
            where: { id },
          });

          await tx.priceSheets.updateMany({
            where: {
              branchId: branchId ?? current.branchId,
              isPublic: true,
              id: { not: id },
            },
            data: { isPublic: false },
          });
        }

        return tx.priceSheets.update({
          where: { id },
          data: {
            ...rest,
            ...(isPublic !== undefined && { isPublic }),
            ...(branchId && { branch: { connect: { id: branchId } } }),
          },
        });
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
