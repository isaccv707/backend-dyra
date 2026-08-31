import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DeviceStatus, Prisma, SafeguardConditionState, SafeguardUsageType } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';
import { assertBranchAccess, BranchScopedUser, userBranchFilter } from 'src/common/utils/branch-access.util';
import { CloudinaryService } from 'src/common/cloudinary/cloudinary.service';
import { CreateVehicleSafeguardDto } from './dto/create-vehicle-safeguard.dto';
import { FindVehicleSafeguardsDto } from './dto/find-vehicle-safeguards.dto';
import { SignVehicleSafeguardDto } from './dto/sign-vehicle-safeguard.dto';
import { VehicleSafeguardInspectionItemDto } from './dto/vehicle-safeguard-inspection-item.dto';
import {
  getVehicleInspectionItemLabel,
  getVehicleInspectionItemSection,
  VEHICLE_BODY_INSPECTION_ITEMS,
  VEHICLE_REVISION_ITEMS,
} from './constants/vehicle-inspection-items.const';
import { VehicleSafeguardPdfData } from './interfaces/vehicle-safeguard-pdf-interfaces';
import { VehicleSafeguardPdfRenderer } from './pdf/vehicle-safeguard-pdf.renderer';

const DOC_CODE = 'ADM.F.01';
const COMPANY_NAME = 'Diagnóstico y Referencia Analítica S.A. DE C.V.';

const VEHICLE_SAFEGUARD_ALLOWED_FIELDS = ['employeeName', 'area', 'usageType', 'createdAt'];

const VEHICLE_SAFEGUARD_INCLUDE = {
  employee: { select: { id: true, name: true, department: true, position: true } },
  inspectionItems: true,
} satisfies Prisma.VehicleSafeguardInclude;

type VehicleSafeguardWithDetails = Prisma.VehicleSafeguardGetPayload<{ include: typeof VEHICLE_SAFEGUARD_INCLUDE }>;

interface InspectionItemCreateInput {
  itemKey: string;
  section: ReturnType<typeof getVehicleInspectionItemSection>;
  state?: string | null;
  observations?: string | null;
}

// Términos de la asignación (usageType/fechas) y checklist, capturados al
// momento de generar el resguardo — nunca viven en VehicleItem.
export interface CreateFromEmployeeVehicleInput {
  usageType?: SafeguardUsageType;
  startDate?: Date;
  endDate?: Date;
  createdByUserId: string;
  inspectionItems?: VehicleSafeguardInspectionItemDto[];
}

@Injectable()
export class VehicleSafeguardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfRenderer: VehicleSafeguardPdfRenderer,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // ===========================
  // Generación desde inventario
  // ===========================

  // Arma la VIGENTE responsiva de vehículo del empleado (supersededAt: null)
  // a partir del VehicleItem que tiene ASSIGNED en este momento. Marca/
  // modelo/placa/condición se leen en vivo — nunca se piden ni se heredan de
  // una versión previa. Si ya existía una vigente, se marca supersededAt
  // (queda intacta como evidencia histórica) y se crea una fila nueva —
  // nunca se sobreescribe ni se le borra su checklist.
  async createFromEmployeeVehicle(
    tx: Prisma.TransactionClient,
    employeeId: string,
    input: CreateFromEmployeeVehicleInput,
  ): Promise<VehicleSafeguardWithDetails> {
    const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });

    const vehicle = await tx.vehicleItem.findFirst({
      where: { employeeId, status: DeviceStatus.ASSIGNED },
      include: { catalog: true },
    });

    if (!vehicle) {
      throw new BadRequestException('El empleado no tiene ningún vehículo asignado actualmente');
    }

    const existing = await tx.vehicleSafeguard.findFirst({
      where: { employeeId, supersededAt: null },
      include: VEHICLE_SAFEGUARD_INCLUDE,
    });

    const usageType = input.usageType ?? existing?.usageType;
    if (!usageType) {
      throw new BadRequestException('usageType es obligatorio para generar la primera responsiva del empleado');
    }
    const startDate = input.startDate ?? existing?.startDate ?? null;
    const endDate = input.endDate ?? existing?.endDate ?? null;

    // Carry-forward solo si la responsiva vigente ya era de ESTE MISMO
    // vehicleId — si el vehículo cambió, hay que capturar el checklist de nuevo.
    let inspectionItemsData: InspectionItemCreateInput[];
    if (input.inspectionItems) {
      inspectionItemsData = this.resolveInspectionItems(input.inspectionItems);
    } else if (existing?.vehicleId === vehicle.id) {
      inspectionItemsData = existing.inspectionItems.map((item) => ({
        itemKey: item.itemKey,
        section: item.section,
        state: item.state,
        observations: item.observations,
      }));
    } else {
      inspectionItemsData = [];
    }

    if (existing) {
      await tx.vehicleSafeguard.update({
        where: { id: existing.id },
        data: { supersededAt: new Date() },
      });
    }

    return tx.vehicleSafeguard.create({
      data: {
        employeeId,
        vehicleId: vehicle.id,
        branchId: employee.branchId,
        employeeName: employee.name,
        position: employee.position,
        area: employee.department,
        brand: vehicle.catalog.brand,
        model: vehicle.catalog.model,
        mileage: vehicle.mileage,
        plateNumber: vehicle.plateNumber,
        fuelType: vehicle.fuelType,
        transmission: vehicle.transmission,
        condition: vehicle.condition,
        usageType,
        startDate,
        endDate,
        createdByUserId: input.createdByUserId,
        ...(inspectionItemsData.length && { inspectionItems: { create: inspectionItemsData } }),
      },
      include: VEHICLE_SAFEGUARD_INCLUDE,
    });
  }

  async create(dto: CreateVehicleSafeguardDto, user: BranchScopedUser & { id: string }) {
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) {
      throw new NotFoundException(`Employee with ID '${dto.employeeId}' not found`);
    }
    assertBranchAccess(user, employee.branchId);

    try {
      return await this.prisma.$transaction((tx) =>
        this.createFromEmployeeVehicle(tx, dto.employeeId, {
          usageType: dto.usageType,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          createdByUserId: user.id,
          inspectionItems: dto.inspectionItems,
        }),
      );
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleSafeguard');
    }
  }

  async findAll(dto: FindVehicleSafeguardsDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['employeeName', 'area'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: VEHICLE_SAFEGUARD_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
      ...(dto.employeeId && { employeeId: dto.employeeId }),
      ...(!dto.includeHistory && { supersededAt: null }),
    } as Prisma.VehicleSafeguardWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.vehicleSafeguard.findMany({ skip, take, where: finalWhere, orderBy, include: VEHICLE_SAFEGUARD_INCLUDE }),
      this.prisma.vehicleSafeguard.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string, user: BranchScopedUser): Promise<VehicleSafeguardWithDetails> {
    const safeguard = await this.prisma.vehicleSafeguard.findUnique({ where: { id }, include: VEHICLE_SAFEGUARD_INCLUDE });
    if (!safeguard) {
      throw new NotFoundException(`VehicleSafeguard with ID '${id}' not found`);
    }
    assertBranchAccess(user, safeguard.branchId);

    return safeguard;
  }

  async remove(id: string, user: BranchScopedUser) {
    const safeguard = await this.findOne(id, user);

    if (safeguard.supersededAt) {
      throw new BadRequestException(
        'No se pueden eliminar versiones históricas del resguardo; solo la vigente.',
      );
    }

    try {
      return await this.prisma.vehicleSafeguard.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleSafeguard');
    }
  }

  // Cierra la responsiva vigente del empleado sin generar una nueva — se usa
  // al hacer offboard (el empleado ya no tiene vehículo asignado).
  async closeCurrentForEmployee(tx: Prisma.TransactionClient, employeeId: string) {
    await tx.vehicleSafeguard.updateMany({
      where: { employeeId, supersededAt: null },
      data: { supersededAt: new Date() },
    });
  }

  // Confirma la firma de la versión VIGENTE, con o sin documento adjunto.
  // A diferencia de Safeguard (IT), esto NO toca Employee.hasSignedResponsibility
  // — es un documento totalmente independiente, con su propia evidencia.
  async sign(id: string, dto: SignVehicleSafeguardDto, user: BranchScopedUser & { id: string }) {
    const safeguard = await this.findOne(id, user);

    if (safeguard.supersededAt) {
      throw new BadRequestException('No se puede firmar una versión histórica del resguardo');
    }

    try {
      return await this.prisma.vehicleSafeguard.update({
        where: { id },
        data: {
          signedAt: new Date(),
          signedByUserId: user.id,
          signedDocumentPublicId: dto.signedDocumentPublicId ?? null,
        },
        include: VEHICLE_SAFEGUARD_INCLUDE,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleSafeguard');
    }
  }

  async getSignedDocumentUrl(id: string, user: BranchScopedUser) {
    const safeguard = await this.findOne(id, user);

    if (!safeguard.signedDocumentPublicId) {
      throw new NotFoundException('Este resguardo no tiene un documento firmado adjunto');
    }

    return this.cloudinaryService.getSignedDownloadUrl(safeguard.signedDocumentPublicId);
  }

  buildSafeguardPdf(doc: PDFKit.PDFDocument, safeguard: VehicleSafeguardWithDetails): void {
    const data = this.buildPdfData(safeguard);
    this.pdfRenderer.render(doc, data);
  }

  // ===========================
  // Helpers privados
  // ===========================

  private resolveInspectionItems(items?: VehicleSafeguardInspectionItemDto[]) {
    if (!items?.length) return [];

    const keys = items.map((item) => item.itemKey);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    if (duplicates.length) {
      throw new BadRequestException(`itemKey duplicado(s) en inspectionItems: ${[...new Set(duplicates)].join(', ')}`);
    }

    return items.map((item) => ({
      itemKey: item.itemKey,
      section: getVehicleInspectionItemSection(item.itemKey),
      state: item.state,
      observations: item.observations,
    }));
  }

  private buildPdfData(safeguard: VehicleSafeguardWithDetails): VehicleSafeguardPdfData {
    return {
      meta: {
        formattedDate: safeguard.createdAt.toLocaleDateString('es-MX'),
        docCode: DOC_CODE,
        companyName: COMPANY_NAME,
        logoPath: this.resolveLogoPath(),
      },
      employee: {
        employeeName: safeguard.employeeName,
        position: safeguard.position ?? '',
        area: safeguard.area,
      },
      usage: {
        usageType: safeguard.usageType,
        formattedStartDate: safeguard.startDate ? safeguard.startDate.toLocaleDateString('es-MX') : null,
        formattedEndDate: safeguard.endDate ? safeguard.endDate.toLocaleDateString('es-MX') : null,
      },
      vehicle: {
        brand: safeguard.brand,
        model: safeguard.model,
        mileage: safeguard.mileage ?? '',
        plateNumber: safeguard.plateNumber ?? '',
        fuelType: safeguard.fuelType ?? '',
        transmission: safeguard.transmission ?? '',
        conditionLabel: this.conditionLabel(safeguard.condition),
        revisionRows: this.buildInspectionRows(VEHICLE_REVISION_ITEMS, safeguard.inspectionItems),
        inspectionRows: this.buildInspectionRows(VEHICLE_BODY_INSPECTION_ITEMS, safeguard.inspectionItems),
      },
    };
  }

  private buildInspectionRows(
    canonicalItems: { key: string; label: string }[],
    submitted: { itemKey: string; state: string | null; observations: string | null }[],
  ) {
    const byKey = new Map(submitted.map((item) => [item.itemKey, item]));

    return canonicalItems.map(({ key, label }) => {
      const found = byKey.get(key);
      return {
        label: label ?? getVehicleInspectionItemLabel(key),
        state: found?.state ?? '',
        observations: found?.observations ?? '',
      };
    });
  }

  private conditionLabel(condition: SafeguardConditionState): string {
    return condition === SafeguardConditionState.NEW ? 'Nuevo' : 'Seminuevo';
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

    console.warn('No se pudo cargar el logo para el PDF de resguardo de vehículo. Ninguna ruta encontrada:', candidatePaths);

    return null;
  }
}
