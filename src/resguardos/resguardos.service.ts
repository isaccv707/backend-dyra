import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  DeviceStatus,
  Prisma,
  ResguardoConditionState,
  ResguardoUsageType,
} from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';
import { assertBranchAccess, BranchScopedUser, userBranchFilter } from 'src/common/utils/branch-access.util';
import { CreateResguardoDto } from './dto/create-resguardo.dto';
import { FindResguardosDto } from './dto/find-resguardos.dto';
import { ResguardoVehicleInspectionItemDto } from './dto/resguardo-vehicle-inspection-item.dto';
import {
  ACCESSORY_DEVICE_TYPES,
  SECTION_DEVICE_TYPE,
} from './constants/resguardable-device-types.const';
import {
  getVehicleInspectionItemLabel,
  getVehicleInspectionItemSection,
  VEHICLE_BODY_INSPECTION_ITEMS,
  VEHICLE_REVISION_ITEMS,
} from './constants/vehicle-inspection-items.const';
import { ResguardoPdfData, VehicleInspectionRow } from './interfaces/resguardo-pdf-interfaces';
import { ResguardoPdfRenderer } from './pdf/resguardo-pdf.renderer';

const DOC_CODE = 'ADM.F.00';
const COMPANY_NAME = 'Diagnóstico y Referencia Analítica S.A. DE C.V.';

const RESGUARDO_ALLOWED_FIELDS = ['employeeName', 'area', 'usageType', 'createdAt'];

const RESGUARDO_INCLUDE = {
  employee: { select: { id: true, name: true, department: true, position: true } },
  computer: { include: { accessoryDetails: true } },
  mobile: { include: { accessoryDetails: true } },
  vehicle: { include: { inspectionItems: true } },
} satisfies Prisma.ResguardoInclude;

type ResguardoWithDetails = Prisma.ResguardoGetPayload<{ include: typeof RESGUARDO_INCLUDE }>;

interface VehicleInspectionItemCreateInput {
  itemKey: string;
  section: ReturnType<typeof getVehicleInspectionItemSection>;
  state?: string | null;
  observations?: string | null;
}

// Todo lo que NO vive en DeviceItem: términos de la asignación (usageType/
// fechas) y checklist/accesorios sin identificador propio, capturados al
// momento de generar el resguardo. Marca/modelo/serie/placa/condición/
// observaciones siempre se leen en vivo del DeviceItem correspondiente.
export interface CreateFromEmployeeDevicesInput {
  usageType?: ResguardoUsageType;
  startDate?: Date;
  endDate?: Date;
  createdByUserId: string;
  inspectionItems?: ResguardoVehicleInspectionItemDto[];
  mobileAccessories?: string[];
}

@Injectable()
export class ResguardosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfRenderer: ResguardoPdfRenderer,
  ) {}

  // ===========================
  // Generación desde inventario
  // ===========================

  // Punto central: arma (o regenera) LA responsiva del empleado (una sola
  // fila por empleado — Resguardo.employeeId es @unique) a partir de lo que
  // tiene ASSIGNED en DeviceItem en este momento. Marca/modelo/serie/placa/
  // condición/observaciones se leen en vivo del DeviceItem — nunca se piden
  // ni se heredan de una versión previa, porque son datos permanentes del
  // equipo, no del momento de la firma. Los "Accesorios incluidos" (monitor/
  // teclado/mouse) también se recalculan en vivo.
  // `input.inspectionItems`/`input.mobileAccessories` sí son datos de la
  // firma (no viven en DeviceItem): si se omiten, se heredan de la sección
  // actual de ESE MISMO deviceId dentro de la responsiva vigente del
  // empleado ("carry-forward") — si el vehículo/celular cambió, no hay nada
  // que heredar y hay que capturarlos de nuevo.
  async createFromEmployeeDevices(
    tx: Prisma.TransactionClient,
    employeeId: string,
    input: CreateFromEmployeeDevicesInput,
  ): Promise<ResguardoWithDetails> {
    const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });

    const assignedDevices = await tx.deviceItem.findMany({
      where: {
        employeeId,
        status: DeviceStatus.ASSIGNED,
        catalog: { type: { in: [SECTION_DEVICE_TYPE.computer, SECTION_DEVICE_TYPE.mobile, SECTION_DEVICE_TYPE.vehicle] } },
      },
      include: { catalog: true, vehicleDetail: true },
    });

    const computerDevice = assignedDevices.find((d) => d.catalog.type === SECTION_DEVICE_TYPE.computer);
    const mobileDevice = assignedDevices.find((d) => d.catalog.type === SECTION_DEVICE_TYPE.mobile);
    const vehicleDevice = assignedDevices.find((d) => d.catalog.type === SECTION_DEVICE_TYPE.vehicle);

    if (!computerDevice && !mobileDevice && !vehicleDevice) {
      throw new BadRequestException(
        'El empleado no tiene ningún equipo de cómputo, celular o vehículo asignado actualmente',
      );
    }

    const existing = await tx.resguardo.findUnique({
      where: { employeeId },
      include: RESGUARDO_INCLUDE,
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
    const vehicleData = vehicleDevice
      ? this.buildVehicleSection(vehicleDevice, existing, input.inspectionItems)
      : undefined;

    // La responsiva es una sola fila por empleado: si ya existía, se
    // reemplazan sus secciones (delete + create) en vez de acumular otra
    // fila de Resguardo — un @@unique([employeeId]) lo impediría de todos
    // modos, pero además así nunca queda una sección "vieja" huérfana (p.ej.
    // el vehículo anterior) colgada del documento.
    if (existing) {
      await Promise.all([
        tx.resguardoComputerDetail.deleteMany({ where: { resguardoId: existing.id } }),
        tx.resguardoMobileDetail.deleteMany({ where: { resguardoId: existing.id } }),
        tx.resguardoVehicleDetail.deleteMany({ where: { resguardoId: existing.id } }),
      ]);
    }

    const sectionsData = {
      ...(computerData && { computer: { create: computerData } }),
      ...(mobileData && { mobile: { create: mobileData } }),
      ...(vehicleData && { vehicle: { create: vehicleData } }),
    };

    const resguardo = await tx.resguardo.upsert({
      where: { employeeId },
      create: {
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
      update: {
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
      include: RESGUARDO_INCLUDE,
    });

    // Generar/regenerar la responsiva es el mismo evento real que este flag
    // representa; ver toggle manual en PATCH /employees/:id/signed-responsibility.
    await tx.employee.update({
      where: { id: employeeId },
      data: { hasSignedResponsibility: true },
    });

    return resguardo;
  }

  async create(dto: CreateResguardoDto, user: BranchScopedUser & { id: string }) {
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
          inspectionItems: dto.inspectionItems,
          mobileAccessories: dto.mobileAccessories,
        }),
      );
    } catch (error) {
      handleDatabaseErrors(error, 'Resguardo');
    }
  }

  async findAll(dto: FindResguardosDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['employeeName', 'area'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: RESGUARDO_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
      ...(dto.employeeId && { employeeId: dto.employeeId }),
    } as Prisma.ResguardoWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.resguardo.findMany({ skip, take, where: finalWhere, orderBy, include: RESGUARDO_INCLUDE }),
      this.prisma.resguardo.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string, user: BranchScopedUser): Promise<ResguardoWithDetails> {
    const resguardo = await this.prisma.resguardo.findUnique({ where: { id }, include: RESGUARDO_INCLUDE });
    if (!resguardo) {
      throw new NotFoundException(`Resguardo with ID '${id}' not found`);
    }
    assertBranchAccess(user, resguardo.branchId);

    return resguardo;
  }

  async remove(id: string, user: BranchScopedUser) {
    await this.findOne(id, user);

    try {
      return await this.prisma.resguardo.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, 'Resguardo');
    }
  }

  buildResguardoPdf(doc: PDFKit.PDFDocument, resguardo: ResguardoWithDetails): void {
    const data = this.buildPdfData(resguardo);
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
    existing: ResguardoWithDetails | null,
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

  private buildVehicleSection(
    device: Prisma.DeviceItemGetPayload<{ include: { catalog: true; vehicleDetail: true } }>,
    existing: ResguardoWithDetails | null,
    inspectionItemsInput?: ResguardoVehicleInspectionItemDto[],
  ) {
    // Carry-forward solo si la responsiva vigente ya tenía sección vehicle
    // para ESTE MISMO deviceId — si el vehículo cambió, hay que capturar el
    // checklist de nuevo.
    let inspectionItemsData: VehicleInspectionItemCreateInput[];
    if (inspectionItemsInput) {
      inspectionItemsData = this.resolveInspectionItems(inspectionItemsInput);
    } else if (existing?.vehicle?.deviceId === device.id) {
      inspectionItemsData = existing.vehicle.inspectionItems.map((item) => ({
        itemKey: item.itemKey,
        section: item.section,
        state: item.state,
        observations: item.observations,
      }));
    } else {
      inspectionItemsData = [];
    }

    return {
      deviceId: device.id,
      brand: device.catalog.brand,
      model: device.catalog.model,
      mileage: device.vehicleDetail?.mileage,
      plateNumber: device.vehicleDetail?.plateNumber,
      fuelType: device.vehicleDetail?.fuelType,
      transmission: device.vehicleDetail?.transmission,
      condition: device.condition,
      ...(inspectionItemsData.length && { inspectionItems: { create: inspectionItemsData } }),
    };
  }

  private resolveInspectionItems(items?: ResguardoVehicleInspectionItemDto[]) {
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

  // ===========================
  // Helpers privados: PDF
  // ===========================

  private buildPdfData(resguardo: ResguardoWithDetails): ResguardoPdfData {
    return {
      meta: {
        formattedDate: resguardo.createdAt.toLocaleDateString('es-MX'),
        docCode: DOC_CODE,
        companyName: COMPANY_NAME,
        logoPath: this.resolveLogoPath(),
      },
      employee: {
        employeeName: resguardo.employeeName,
        position: resguardo.position ?? '',
        area: resguardo.area,
      },
      usage: {
        usageType: resguardo.usageType,
        usageLabel: resguardo.usageType === ResguardoUsageType.TEMPORARY ? 'Temporal' : 'Permanente',
        formattedStartDate: resguardo.startDate ? resguardo.startDate.toLocaleDateString('es-MX') : null,
        formattedEndDate: resguardo.endDate ? resguardo.endDate.toLocaleDateString('es-MX') : null,
      },
      computer: resguardo.computer
        ? {
            brand: resguardo.computer.brand,
            model: resguardo.computer.model,
            serialNumber: resguardo.computer.serialNumber ?? '',
            internalCode: resguardo.computer.internalCode ?? '',
            hardDrive: resguardo.computer.hardDrive ?? '',
            processor: resguardo.computer.processor ?? '',
            accessories: this.composeAccessoriesLabel(resguardo.computer.accessoryDetails),
            conditionLabel: this.conditionLabel(resguardo.computer.condition),
            observations: resguardo.computer.observations ?? '',
          }
        : undefined,
      mobile: resguardo.mobile
        ? {
            brand: resguardo.mobile.brand,
            model: resguardo.mobile.model,
            imei: resguardo.mobile.imei ?? '',
            phoneNumber: resguardo.mobile.phoneNumber ?? '',
            accessories: this.composeAccessoriesLabel(resguardo.mobile.accessoryDetails),
            conditionLabel: this.conditionLabel(resguardo.mobile.condition),
            observations: resguardo.mobile.observations ?? '',
          }
        : undefined,
      vehicle: resguardo.vehicle
        ? {
            brand: resguardo.vehicle.brand,
            model: resguardo.vehicle.model,
            mileage: resguardo.vehicle.mileage ?? '',
            plateNumber: resguardo.vehicle.plateNumber ?? '',
            fuelType: resguardo.vehicle.fuelType ?? '',
            transmission: resguardo.vehicle.transmission ?? '',
            conditionLabel: this.conditionLabel(resguardo.vehicle.condition),
            revisionRows: this.buildInspectionRows(VEHICLE_REVISION_ITEMS, resguardo.vehicle.inspectionItems),
            inspectionRows: this.buildInspectionRows(VEHICLE_BODY_INSPECTION_ITEMS, resguardo.vehicle.inspectionItems),
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

  private buildInspectionRows(
    canonicalItems: { key: string; label: string }[],
    submitted: { itemKey: string; state: string | null; observations: string | null }[],
  ): VehicleInspectionRow[] {
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

  private conditionLabel(condition: ResguardoConditionState): string {
    return condition === ResguardoConditionState.NEW ? 'Nuevo' : 'Seminuevo';
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
