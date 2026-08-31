import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  DeviceStatus,
  Prisma,
  SafeguardConditionState,
  SafeguardUsageType,
} from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';
import { assertBranchAccess, BranchScopedUser, userBranchFilter } from 'src/common/utils/branch-access.util';
import { CloudinaryService } from 'src/common/cloudinary/cloudinary.service';
import { CreateSafeguardDto } from './dto/create-safeguard.dto';
import { FindSafeguardsDto } from './dto/find-safeguards.dto';
import { SignSafeguardDto } from './dto/sign-safeguard.dto';
import {
  ACCESSORY_DEVICE_TYPES,
  SECTION_DEVICE_TYPE,
} from './constants/safeguardable-device-types.const';
import { SafeguardPdfData } from './interfaces/safeguard-pdf-interfaces';
import { SafeguardPdfRenderer } from './pdf/safeguard-pdf.renderer';

const DOC_CODE = 'ADM.F.00';
const COMPANY_NAME = 'Diagnóstico y Referencia Analítica S.A. DE C.V.';

const SAFEGUARD_ALLOWED_FIELDS = ['employeeName', 'area', 'usageType', 'createdAt'];

const SAFEGUARD_INCLUDE = {
  employee: { select: { id: true, name: true, department: true, position: true } },
  computer: { include: { accessoryDetails: true } },
  mobile: { include: { accessoryDetails: true } },
} satisfies Prisma.SafeguardInclude;

type SafeguardWithDetails = Prisma.SafeguardGetPayload<{ include: typeof SAFEGUARD_INCLUDE }>;

// Todo lo que NO vive en DeviceItem: términos de la asignación (usageType/
// fechas) y accesorios de celular sin identificador propio, capturados al
// momento de generar el resguardo. Marca/modelo/serie/condición/
// observaciones siempre se leen en vivo del DeviceItem correspondiente.
export interface CreateFromEmployeeDevicesInput {
  usageType?: SafeguardUsageType;
  startDate?: Date;
  endDate?: Date;
  createdByUserId: string;
  mobileAccessories?: string[];
}

@Injectable()
export class SafeguardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfRenderer: SafeguardPdfRenderer,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // ===========================
  // Generación desde inventario
  // ===========================

  // Punto central: arma la VIGENTE responsiva del empleado (supersededAt:
  // null) a partir de lo que tiene ASSIGNED en DeviceItem en este momento.
  // Marca/modelo/serie/placa/condición/observaciones se leen en vivo del
  // DeviceItem — nunca se piden ni se heredan de una versión previa, porque
  // son datos permanentes del equipo, no del momento de la firma. Los
  // "Accesorios incluidos" (monitor/teclado/mouse) también se recalculan en
  // vivo.
  // `input.inspectionItems`/`input.mobileAccessories` sí son datos de la
  // firma (no viven en DeviceItem): si se omiten, se heredan de la sección
  // actual de ESE MISMO deviceId dentro de la responsiva vigente del
  // empleado ("carry-forward") — si el vehículo/celular cambió, no hay nada
  // que heredar y hay que capturarlos de nuevo.
  // Si ya existía una vigente, se marca supersededAt (queda intacta como
  // evidencia histórica de lo que se pudo haber firmado) y se crea una fila
  // nueva — nunca se sobreescribe ni se le borran sus secciones.
  async createFromEmployeeDevices(
    tx: Prisma.TransactionClient,
    employeeId: string,
    input: CreateFromEmployeeDevicesInput,
  ): Promise<SafeguardWithDetails> {
    const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });

    const assignedDevices = await tx.deviceItem.findMany({
      where: {
        employeeId,
        status: DeviceStatus.ASSIGNED,
        catalog: { type: { in: [SECTION_DEVICE_TYPE.computer, SECTION_DEVICE_TYPE.mobile] } },
      },
      include: { catalog: true },
    });

    const computerDevice = assignedDevices.find((d) => d.catalog.type === SECTION_DEVICE_TYPE.computer);
    const mobileDevice = assignedDevices.find((d) => d.catalog.type === SECTION_DEVICE_TYPE.mobile);

    if (!computerDevice && !mobileDevice) {
      throw new BadRequestException(
        'El empleado no tiene ningún equipo de cómputo o celular asignado actualmente',
      );
    }

    const existing = await tx.safeguard.findFirst({
      where: { employeeId, supersededAt: null },
      include: SAFEGUARD_INCLUDE,
    });

    const usageType = input.usageType ?? existing?.usageType;
    if (!usageType) {
      throw new BadRequestException('usageType es obligatorio para generar la primera responsiva del empleado');
    }
    const startDate = input.startDate ?? existing?.startDate ?? null;
    const endDate = input.endDate ?? existing?.endDate ?? null;

    const computerData = computerDevice
      ? await this.buildComputerSection(tx, computerDevice)
      : undefined;
    const mobileData = mobileDevice
      ? this.buildMobileSection(mobileDevice, existing, input.mobileAccessories)
      : undefined;

    // Si ya había una vigente, se cierra (queda intacta con sus secciones,
    // es evidencia histórica) y se crea una fila nueva — nunca se sobreescribe.
    if (existing) {
      await tx.safeguard.update({
        where: { id: existing.id },
        data: { supersededAt: new Date() },
      });
    }

    const sectionsData = {
      ...(computerData && { computer: { create: computerData } }),
      ...(mobileData && { mobile: { create: mobileData } }),
    };

    const safeguard = await tx.safeguard.create({
      data: {
        employeeId,
        branchId: employee.branchId,
        employeeName: employee.name,
        position: employee.position,
        area: employee.department,
        usageType,
        startDate,
        endDate,
        createdByUserId: input.createdByUserId,
        ...sectionsData,
      },
      include: SAFEGUARD_INCLUDE,
    });

    // La versión nueva nunca hereda la firma de la anterior: si el contenido
    // cambió, hay que volver a firmar. hasSignedResponsibility es un flag
    // denormalizado en Employee que solo esta clase mantiene en sync (ver
    // también sign()); ya no se togglea a mano desde fuera.
    await tx.employee.update({
      where: { id: employeeId },
      data: { hasSignedResponsibility: false },
    });

    return safeguard;
  }

  async create(dto: CreateSafeguardDto, user: BranchScopedUser & { id: string }) {
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) {
      throw new NotFoundException(`Employee with ID '${dto.employeeId}' not found`);
    }
    assertBranchAccess(user, employee.branchId);

    try {
      return await this.prisma.$transaction((tx) =>
        this.createFromEmployeeDevices(tx, dto.employeeId, {
          usageType: dto.usageType,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          createdByUserId: user.id,
          mobileAccessories: dto.mobileAccessories,
        }),
      );
    } catch (error) {
      handleDatabaseErrors(error, 'Safeguard');
    }
  }

  async findAll(dto: FindSafeguardsDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['employeeName', 'area'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: SAFEGUARD_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
      ...(dto.employeeId && { employeeId: dto.employeeId }),
      ...(!dto.includeHistory && { supersededAt: null }),
    } as Prisma.SafeguardWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.safeguard.findMany({ skip, take, where: finalWhere, orderBy, include: SAFEGUARD_INCLUDE }),
      this.prisma.safeguard.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string, user: BranchScopedUser): Promise<SafeguardWithDetails> {
    const safeguard = await this.prisma.safeguard.findUnique({ where: { id }, include: SAFEGUARD_INCLUDE });
    if (!safeguard) {
      throw new NotFoundException(`Safeguard with ID '${id}' not found`);
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
      return await this.prisma.safeguard.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, 'Safeguard');
    }
  }

  // Cierra la responsiva vigente del empleado sin generar una nueva — se usa
  // al hacer offboard (el empleado ya no tiene equipo asignado, así que no
  // hay contenido para una versión nueva).
  async closeCurrentForEmployee(tx: Prisma.TransactionClient, employeeId: string) {
    await tx.safeguard.updateMany({
      where: { employeeId, supersededAt: null },
      data: { supersededAt: new Date() },
    });
  }

  // Confirma la firma de la versión VIGENTE de un resguardo, con o sin
  // documento adjunto (signedDocumentPublicId). Es la única forma soportada
  // de marcar Employee.hasSignedResponsibility en true.
  async sign(id: string, dto: SignSafeguardDto, user: BranchScopedUser & { id: string }) {
    const safeguard = await this.findOne(id, user);

    if (safeguard.supersededAt) {
      throw new BadRequestException('No se puede firmar una versión histórica del resguardo');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const signed = await tx.safeguard.update({
          where: { id },
          data: {
            signedAt: new Date(),
            signedByUserId: user.id,
            signedDocumentPublicId: dto.signedDocumentPublicId ?? null,
          },
          include: SAFEGUARD_INCLUDE,
        });

        await tx.employee.update({
          where: { id: safeguard.employeeId },
          data: { hasSignedResponsibility: true },
        });

        return signed;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Safeguard');
    }
  }

  async getSignedDocumentUrl(id: string, user: BranchScopedUser) {
    const safeguard = await this.findOne(id, user);

    if (!safeguard.signedDocumentPublicId) {
      throw new NotFoundException('Este resguardo no tiene un documento firmado adjunto');
    }

    return this.cloudinaryService.getSignedDownloadUrl(safeguard.signedDocumentPublicId);
  }

  // Firma los parámetros para que el frontend suba el PDF firmado escaneado
  // directo a Cloudinary (carpeta "safeguards", prefijo "device-" para no
  // chocar con los public_id de resguardos de vehículo). El public_id
  // resultante se manda después a sign().
  async createUploadSignature(id: string, user: BranchScopedUser) {
    const safeguard = await this.findOne(id, user);

    if (safeguard.supersededAt) {
      throw new BadRequestException('No se puede adjuntar un documento a una versión histórica del resguardo');
    }

    const publicId = `safeguards/device-${safeguard.id}-${Date.now()}`;
    return this.cloudinaryService.generateSignedUploadParams(publicId);
  }

  buildSafeguardPdf(doc: PDFKit.PDFDocument, safeguard: SafeguardWithDetails): void {
    const data = this.buildPdfData(safeguard);
    this.pdfRenderer.render(doc, data);
  }

  // ===========================
  // Helpers privados: armado de secciones
  // ===========================

  private async buildComputerSection(
    tx: Prisma.TransactionClient,
    device: Prisma.DeviceItemGetPayload<{ include: { catalog: true } }>,
  ) {
    // Los accesorios de "Accesorios incluidos" se enlazan a ESTA computadora
    // por mainDeviceId (no por employeeId) — ver DevicesService (create/
    // update con mainDeviceId, y el cascade en assign/unassign/retire/traspaso).
    const accessoryDevices = await tx.deviceItem.findMany({
      where: { mainDeviceId: device.id, catalog: { type: { in: ACCESSORY_DEVICE_TYPES } } },
      include: { catalog: true },
    });

    return {
      deviceId: device.id,
      brand: device.catalog.brand,
      model: device.catalog.model,
      serialNumber: device.serialNumber,
      internalCode: device.internalCode,
      hardDrive: device.hardDrive,
      processor: device.processor,
      condition: device.condition,
      observations: device.notes,
      ...(accessoryDevices.length && {
        accessoryDetails: {
          create: accessoryDevices.map((a) => ({
            deviceId: a.id,
            name: a.catalog.name,
            brand: a.catalog.brand,
            model: a.catalog.model,
            serialNumber: a.serialNumber,
            internalCode: a.internalCode,
          })),
        },
      }),
    };
  }

  private buildMobileSection(
    device: Prisma.DeviceItemGetPayload<{ include: { catalog: true } }>,
    existing: SafeguardWithDetails | null,
    mobileAccessoriesInput?: string[],
  ) {
    // Carry-forward solo si la responsiva vigente ya tenía sección mobile
    // para ESTE MISMO deviceId — si el celular cambió, no hay nada que
    // heredar y mobileAccessories se queda vacío hasta que se capture de nuevo.
    let mobileAccessories: string[];
    if (mobileAccessoriesInput) {
      mobileAccessories = mobileAccessoriesInput;
    } else if (existing?.mobile?.deviceId === device.id) {
      mobileAccessories = existing.mobile.accessoryDetails.map((a) => a.name);
    } else {
      mobileAccessories = [];
    }

    return {
      deviceId: device.id,
      brand: device.catalog.brand,
      model: device.catalog.model,
      imei: device.serialNumber,
      phoneNumber: device.phoneNumber,
      condition: device.condition,
      observations: device.notes,
      ...(mobileAccessories.length && {
        accessoryDetails: { create: mobileAccessories.map((name) => ({ name })) },
      }),
    };
  }

  // ===========================
  // Helpers privados: PDF
  // ===========================

  private buildPdfData(safeguard: SafeguardWithDetails): SafeguardPdfData {
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
        usageLabel: safeguard.usageType === SafeguardUsageType.TEMPORARY ? 'Temporal' : 'Permanente',
        formattedStartDate: safeguard.startDate ? safeguard.startDate.toLocaleDateString('es-MX') : null,
        formattedEndDate: safeguard.endDate ? safeguard.endDate.toLocaleDateString('es-MX') : null,
      },
      computer: safeguard.computer
        ? {
            brand: safeguard.computer.brand,
            model: safeguard.computer.model,
            serialNumber: safeguard.computer.serialNumber ?? '',
            internalCode: safeguard.computer.internalCode ?? '',
            hardDrive: safeguard.computer.hardDrive ?? '',
            processor: safeguard.computer.processor ?? '',
            accessories: this.composeAccessoriesLabel(safeguard.computer.accessoryDetails),
            conditionLabel: this.conditionLabel(safeguard.computer.condition),
            observations: safeguard.computer.observations ?? '',
          }
        : undefined,
      mobile: safeguard.mobile
        ? {
            brand: safeguard.mobile.brand,
            model: safeguard.mobile.model,
            imei: safeguard.mobile.imei ?? '',
            phoneNumber: safeguard.mobile.phoneNumber ?? '',
            accessories: this.composeAccessoriesLabel(safeguard.mobile.accessoryDetails),
            conditionLabel: this.conditionLabel(safeguard.mobile.condition),
            observations: safeguard.mobile.observations ?? '',
          }
        : undefined,
    };
  }

  private composeAccessoriesLabel(
    accessoryDetails: { name: string; serialNumber: string | null; internalCode: string | null }[],
  ): string {
    if (!accessoryDetails.length) return '';

    return accessoryDetails
      .map((a) => {
        const codes = [a.serialNumber && `S/N ${a.serialNumber}`, a.internalCode].filter(Boolean);
        return codes.length ? `${a.name} (${codes.join(' — ')})` : a.name;
      })
      .join('; ');
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

    console.warn('No se pudo cargar el logo para el PDF de resguardo. Ninguna ruta encontrada:', candidatePaths);

    return null;
  }
}
