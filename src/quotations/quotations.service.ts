// quotations.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { CreateQuotationDto, SelectedStudyDto } from './dto/create-quotation.dto';
import { FindQuotationsDto } from './dto/find-quotations.dto';
import {
  CompanyInfo,
  QuotationMeta,
  QuotationPdfData,
  Totals,
} from './interfaces/quotations-interfaces';
import { QuotationPdfRenderer } from './pdf/quotation-pdf.renderer';

const COMPANY_NAME = 'Diagnóstico y Referencia Analítica';
const COMPANY_SUBTITLE = 'Cotización de estudios de laboratorio';

// Usados como respaldo si a la sucursal le faltan datos (phone/email son
// opcionales en el modelo Branch); toda cotización tiene branchId.
const FALLBACK_COMPANY_INFO: CompanyInfo = {
  name: COMPANY_NAME,
  subtitle: COMPANY_SUBTITLE,
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
  'priceSheet.name',
];

const QUOTATION_BRANCH_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  address: {
    select: {
      street: true,
      extNumber: true,
      intNumber: true,
      neighborhood: true,
      city: true,
      zipCode: true,
    },
  },
} satisfies Prisma.BranchSelect;

type QuotationBranch = Prisma.BranchGetPayload<{
  select: typeof QUOTATION_BRANCH_SELECT;
}>;

type QuotationWithItems = Quotation & {
  items: QuotationItem[];
  branch?: QuotationBranch | null;
  priceSheet?: { id: string; name: string } | null;
};

type ResolvedQuotationItem = {
  name: string;
  price: number;
  quantity: number;
  studyId: string | null;
};

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfRenderer: QuotationPdfRenderer,
  ) {}

  // Flujo público (usuarios de la página web, sin login): solo puede
  // cotizar contra la hoja de precios pública de la sucursal.
  async create(dto: CreateQuotationDto): Promise<QuotationWithItems> {
    return this.createQuotation(dto, { requirePublicPriceSheet: true });
  }

  // Flujo admin (staff autenticado con `quotations:create`): puede cotizar
  // contra cualquier hoja de precios activa de una sucursal a la que tenga acceso.
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
      throw new NotFoundException(
        `Branch with ID '${dto.branchId}' not found`,
      );
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

  // ===========================
  // RESOLUCIÓN DE PRECIOS
  // ===========================
  // Los estudios de catálogo (con `id`) nunca confían en el precio/nombre
  // enviado por el cliente: se resuelven contra el StudyOnPriceSheet de la
  // hoja de precios (ya validada en `createQuotation`) para evitar que la
  // cotización se manipule desde el frontend. Solo las líneas ad-hoc (sin
  // `id`, fuera de catálogo) usan lo enviado.
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

    let priceByStudyId = new Map<string, { name: string; price: Prisma.Decimal }>();

    if (catalogStudyIds.length > 0) {
      const entries = await this.prisma.studyOnPriceSheet.findMany({
        where: { studyId: { in: catalogStudyIds }, priceSheetId: dto.priceSheetId },
        include: { study: { select: { name: true } } },
      });

      priceByStudyId = new Map(
        entries.map((entry) => [
          entry.studyId,
          { name: entry.study.name, price: entry.price },
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
        price: resolved ? Number(resolved.price) : study.price,
        quantity: study.quantity,
        studyId: study.id ?? null,
      };
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
        include: {
          items: true,
          branch: { select: { id: true, name: true } },
          priceSheet: { select: { id: true, name: true } },
        },
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
      include: {
        items: true,
        branch: { select: QUOTATION_BRANCH_SELECT },
        priceSheet: { select: { id: true, name: true } },
      },
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
      company: this.buildCompanyInfo(quotation.branch ?? null),
    };
  }

  private buildCompanyInfo(branch: QuotationBranch | null): CompanyInfo {
    if (!branch) {
      return FALLBACK_COMPANY_INFO;
    }

    return {
      name: COMPANY_NAME,
      subtitle: COMPANY_SUBTITLE,
      address: this.formatBranchAddress(branch.address),
      phone: branch.phone ?? FALLBACK_COMPANY_INFO.phone,
      email: branch.email ?? FALLBACK_COMPANY_INFO.email,
    };
  }

  private formatBranchAddress(address: QuotationBranch['address']): string {
    const streetLine = address.intNumber
      ? `${address.street} #${address.extNumber} Int. ${address.intNumber}`
      : `${address.street} #${address.extNumber}`;

    return [streetLine, address.neighborhood, address.city]
      .filter((part): part is string => Boolean(part))
      .join(', ');
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
