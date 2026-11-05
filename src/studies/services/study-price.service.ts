import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { AssignPriceSheetDto } from '../dto/assign-price-sheet.dto';
import { StudyPriceDto } from '../dto/create-study.dto';
import { StudyDb } from '../types/study-db.type';
import { handleStudyDbErrors } from '../utils/study-mappers.util';
import { StudyValidationService } from './study-validation.service';

/** A study's prices across price sheets. */
@Injectable()
export class StudyPriceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: StudyValidationService,
  ) {}

  /**
   * Replaces all of a study's prices: sheets missing from `prices` lose theirs.
   * Same branch rules as `studyPrices` on create.
   */
  async replacePrices(
    studyId: string,
    prices: StudyPriceDto[],
    user: BranchScopedUser,
    db: StudyDb = this.prisma,
  ) {
    const study = await this.validation.findAccessibleStudy(studyId, user, db);
    await this.validation.assertPriceSheetsBelongToBranch(
      prices.map((p) => p.priceSheetId),
      study.branchId,
      db,
    );

    try {
      await db.studyOnPriceSheet.deleteMany({
        where: {
          studyId,
          priceSheetId: { notIn: prices.map((p) => p.priceSheetId) },
        },
      });
      for (const p of prices) {
        const values = {
          price: new Prisma.Decimal(p.price),
          showPrice: p.showPrice ?? true,
        };
        await db.studyOnPriceSheet.upsert({
          where: {
            studyId_priceSheetId: { studyId, priceSheetId: p.priceSheetId },
          },
          update: values,
          create: { ...values, studyId, priceSheetId: p.priceSheetId },
        });
      }
    } catch (error) {
      handleStudyDbErrors(error);
    }
  }

  async assignPriceSheet(
    studyId: string,
    dto: AssignPriceSheetDto,
    user: BranchScopedUser,
  ) {
    const study = await this.validation.findAccessibleStudy(studyId, user);

    const priceSheet = await this.prisma.priceSheets.findUnique({
      where: { id: dto.priceSheetId },
    });
    if (!priceSheet) {
      throw new NotFoundException(
        `Lista de precios con el ID ${dto.priceSheetId} no encontrada`,
      );
    }
    if (priceSheet.branchId !== study.branchId) {
      throw new BadRequestException(
        'La lista de precios pertenece a otra sucursal distinta a la del estudio',
      );
    }

    try {
      return await this.prisma.studyOnPriceSheet.upsert({
        where: {
          studyId_priceSheetId: {
            studyId,
            priceSheetId: dto.priceSheetId,
          },
        },
        update: {
          price: new Prisma.Decimal(dto.price),
          showPrice: dto.showPrice ?? true,
        },
        create: {
          studyId,
          priceSheetId: dto.priceSheetId,
          price: new Prisma.Decimal(dto.price),
          showPrice: dto.showPrice ?? true,
        },
        include: { priceSheet: true },
      });
    } catch (error) {
      handleStudyDbErrors(error);
    }
  }

  async removePriceSheet(
    studyId: string,
    priceSheetId: string,
    user: BranchScopedUser,
  ) {
    await this.validation.findAccessibleStudy(studyId, user);
    const assignment = await this.prisma.studyOnPriceSheet.findUnique({
      where: { studyId_priceSheetId: { studyId, priceSheetId } },
    });
    if (!assignment) {
      throw new NotFoundException(
        `El estudio ${studyId} no tiene precio asignado en la lista de precios ${priceSheetId}`,
      );
    }

    try {
      return await this.prisma.studyOnPriceSheet.delete({
        where: { studyId_priceSheetId: { studyId, priceSheetId } },
      });
    } catch (error) {
      handleStudyDbErrors(error);
    }
  }
}
