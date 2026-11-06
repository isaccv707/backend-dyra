import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  assertBranchAccess,
  BranchScopedUser,
} from 'src/common/utils/branch-access.util';
import {
  loadPanelSnapshots,
  PanelComponentSnapshot,
} from 'src/studies/utils/panel-tree.util';
import { QUOTATION_BRANCH_SELECT } from '../constants/quotation-query.const';
import {
  CreateQuotationDto,
  SelectedStudyDto,
} from '../dto/create-quotation.dto';
import { Totals } from '../interfaces/quotations-interfaces';
import {
  QuotationWithItems,
  ResolvedQuotationItem,
} from '../types/quotation.types';

/**
 * Creates a quotation: validates the branch and price sheet, prices each
 * study from the sheet (custom items keep their price), snapshots panels and
 * computes totals (prices include VAT).
 */
@Injectable()
export class QuotationCreateService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateQuotationDto): Promise<QuotationWithItems> {
    return this.createQuotation(dto, { requirePublicPriceSheet: true });
  }

  async createForAdmin(
    dto: CreateQuotationDto,
    user: BranchScopedUser,
  ): Promise<QuotationWithItems> {
    assertBranchAccess(user, dto.branchId);
    return this.createQuotation(dto, { requirePublicPriceSheet: false });
  }

  private async createQuotation(
    dto: CreateQuotationDto,
    opts: { requirePublicPriceSheet: boolean },
  ): Promise<QuotationWithItems> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.branchId },
      select: QUOTATION_BRANCH_SELECT,
    });
    if (!branch) {
      throw new NotFoundException(`Branch with ID '${dto.branchId}' not found`);
    }

    const priceSheet = await this.prisma.priceSheets.findFirst({
      where: {
        id: dto.priceSheetId,
        branchId: dto.branchId,
        isActive: true,
        ...(opts.requirePublicPriceSheet && { isPublic: true }),
      },
      select: { id: true },
    });
    if (!priceSheet) {
      throw new BadRequestException(
        opts.requirePublicPriceSheet
          ? 'La hoja de precios indicada no existe, no está activa, no pertenece a la sucursal seleccionada, o no es pública.'
          : 'La hoja de precios indicada no existe, no está activa o no pertenece a la sucursal seleccionada.',
      );
    }

    const items = await this.resolveQuotationItems(dto);
    const totals = this.calculateTotals(items);

    const quotation = await this.prisma.quotation.create({
      data: {
        folio: this.generateFolio(),
        clientType: dto.clientType,
        name: dto.name,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber,
        email: dto.email,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        branchId: dto.branchId,
        priceSheetId: priceSheet.id,
        items: { create: items },
      },
      include: { items: true },
    });

    return { ...quotation, branch };
  }

  private async resolveQuotationItems(
    dto: CreateQuotationDto,
  ): Promise<ResolvedQuotationItem[]> {
    const catalogStudyIds = [
      ...new Set(
        dto.studies
          .filter((study): study is SelectedStudyDto & { id: string } =>
            Boolean(study.id),
          )
          .map((study) => study.id),
      ),
    ];

    let priceByStudyId = new Map<
      string,
      { name: string; code: string; price: Prisma.Decimal }
    >();
    let componentsByPanelId = new Map<string, PanelComponentSnapshot[]>();

    if (catalogStudyIds.length > 0) {
      const entries = await this.prisma.studyOnPriceSheet.findMany({
        where: {
          studyId: { in: catalogStudyIds },
          priceSheetId: dto.priceSheetId,
        },
        include: {
          study: {
            select: {
              name: true,
              code: true,
              isPanel: true,
              isActive: true,
            },
          },
        },
      });

      const inactive = entries.filter((entry) => !entry.study.isActive);
      if (inactive.length > 0) {
        throw new BadRequestException(
          `Los siguientes estudios están desactivados y no se pueden cotizar: ${inactive
            .map((entry) => entry.study.code)
            .join(', ')}`,
        );
      }

      componentsByPanelId = await loadPanelSnapshots(
        this.prisma,
        entries.filter((entry) => entry.study.isPanel).map((e) => e.studyId),
      );

      priceByStudyId = new Map(
        entries.map((entry) => [
          entry.studyId,
          {
            name: entry.study.name,
            code: entry.study.code,
            price: entry.price,
          },
        ]),
      );

      const missing = catalogStudyIds.filter((id) => !priceByStudyId.has(id));
      if (missing.length > 0) {
        throw new NotFoundException(
          `Los siguientes estudios no tienen precio configurado en la sucursal seleccionada: ${missing.join(', ')}`,
        );
      }
    }

    return dto.studies.map((study) => {
      const resolved = study.id ? priceByStudyId.get(study.id) : undefined;

      return {
        name: resolved?.name ?? study.name,
        code: resolved?.code ?? null,
        price: resolved ? Number(resolved.price) : study.price,
        quantity: study.quantity,
        studyId: study.id ?? null,
        components: study.id ? componentsByPanelId.get(study.id) : undefined,
      };
    });
  }

  private calculateTotals(
    studies: { price: number; quantity: number }[],
  ): Totals {
    const total = studies.reduce(
      (acc, study) => acc + study.price * study.quantity,
      0,
    );

    const subtotal = Math.round((total / 1.16) * 100) / 100;
    const tax = Math.round((total - subtotal) * 100) / 100;

    return { subtotal, tax, total };
  }

  private generateFolio(): string {
    const now = new Date();
    const datePart = `${now.getFullYear()}${(now.getMonth() + 1)
      .toString()
      .padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;

    return `DYRA-${datePart}-${randomInt(100000, 999999)}`;
  }
}
