// quotations.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma, Quotation, QuotationItem } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import {
  assertBranchAccess,
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { FindQuotationsDto } from './dto/find-quotations.dto';
import {
  CompanyInfo,
  QuotationMeta,
  QuotationPdfData,
  Totals,
} from './interfaces/quotations-interfaces';
import { QuotationPdfRenderer } from './pdf/quotation-pdf.renderer';

const COMPANY_INFO: CompanyInfo = {
  name: 'Diagnóstico y Referencia Analítica',
  subtitle: 'Cotización de estudios de laboratorio',
  address: 'Calle Ignacio Sandoval #1801, col. Girasoles, Colima, col.',
  phone: '33 2230 0412',
  email: 'luis.ramirez@dyranalitica.com',
};

const QUOTATION_ALLOWED_FIELDS = [
  'folio',
  'name',
  'lastName',
  'phoneNumber',
  'total',
  'createdAt',
];

type QuotationWithItems = Quotation & { items: QuotationItem[] };

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfRenderer: QuotationPdfRenderer,
  ) {}

  async create(dto: CreateQuotationDto): Promise<QuotationWithItems> {
    if (dto.branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: dto.branchId },
      });
      if (!branch) {
        throw new NotFoundException(
          `Branch with ID '${dto.branchId}' not found`,
        );
      }
    }

    const totals = this.calculateTotals(dto.studies);

    return this.prisma.quotation.create({
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
        items: {
          create: dto.studies.map((study) => ({
            name: study.name,
            price: study.price,
            quantity: study.quantity,
            studyId: study.id || null,
          })),
        },
      },
      include: { items: true },
    });
  }

  async findAll(dto: FindQuotationsDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['folio', 'name', 'lastName', 'phoneNumber', 'email'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: QUOTATION_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
    } as Prisma.QuotationWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.quotation.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: { items: true, branch: { select: { id: true, name: true } } },
      }),
      this.prisma.quotation.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(
    id: string,
    user: BranchScopedUser,
  ): Promise<QuotationWithItems> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: { items: true, branch: { select: { id: true, name: true } } },
    });
    if (!quotation) {
      throw new NotFoundException(`Quotation with ID '${id}' not found`);
    }
    assertBranchAccess(user, quotation.branchId);

    return quotation;
  }

  async remove(id: string, user: BranchScopedUser) {
    await this.findOne(id, user);

    try {
      return await this.prisma.quotation.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, 'Quotation');
    }
  }

  buildQuotationPdf(
    doc: PDFKit.PDFDocument,
    quotation: QuotationWithItems,
  ): void {
    const data = this.buildPdfData(quotation);
    this.pdfRenderer.render(doc, data);
  }

  private buildPdfData(quotation: QuotationWithItems): QuotationPdfData {
    const meta: QuotationMeta = {
      formattedDate: quotation.createdAt.toLocaleDateString('es-MX'),
      folio: quotation.folio,
      formattedClientType: this.formatClientType(quotation.clientType),
      logoPath: this.resolveLogoPath(),
    };

    return {
      meta,
      totals: {
        subtotal: Number(quotation.subtotal),
        tax: Number(quotation.tax),
        total: Number(quotation.total),
      },
      client: {
        name: quotation.name,
        lastName: quotation.lastName ?? undefined,
        phoneNumber: quotation.phoneNumber,
        email: quotation.email ?? '',
        clientType: meta.formattedClientType,
      },
      studies: quotation.items.map((item) => ({
        name: item.name,
        price: Number(item.price),
        quantity: item.quantity,
      })),
      company: COMPANY_INFO,
    };
  }

  // ===========================
  // CÁLCULOS Y METADATOS
  // ===========================
  private calculateTotals(
    studies: { price: number; quantity: number }[],
  ): Totals {
    const total = studies.reduce(
      (acc, study) => acc + study.price * study.quantity,
      0,
    );

    const tax = total * 0.16;
    const subtotal = total - tax;

    return { subtotal, tax, total };
  }

  private generateFolio(): string {
    const now = new Date();
    const datePart = `${now.getFullYear()}${(now.getMonth() + 1)
      .toString()
      .padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;

    return `DYRA-${datePart}-${randomInt(100000, 999999)}`;
  }

  private formatClientType(clientType: string): string {
    return (
      clientType.charAt(0).toUpperCase() + clientType.slice(1).toLowerCase()
    );
  }

  private resolveLogoPath(): string | null {
    const rootDir = process.cwd();

    const candidatePaths = [
      path.join(rootDir, 'dist', 'assets', 'logo.png'),
      path.join(rootDir, 'src', 'assets', 'logo.png'),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    console.warn(
      'No se pudo cargar el logo para el PDF. Ninguna ruta encontrada:',
      candidatePaths,
    );

    return null;
  }
}
