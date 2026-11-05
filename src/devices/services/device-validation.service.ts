import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceStatus, DeviceType, Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';

/** Lookups and rules shared by device writes and assignments. */
@Injectable()
export class DeviceValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async assertNoDuplicateTypeForEmployee(
    tx: Prisma.TransactionClient,
    employeeId: string,
    catalogType: DeviceType,
    excludeDeviceId?: string,
  ) {
    const conflict = await tx.deviceItem.findFirst({
      where: {
        employeeId,
        status: DeviceStatus.ASSIGNED,
        catalog: { type: catalogType },
        ...(excludeDeviceId && { id: { not: excludeDeviceId } }),
      },
    });
    if (conflict) {
      throw new BadRequestException(
        `El empleado ya tiene un equipo de tipo ${catalogType} asignado (${conflict.internalCode}); libérelo antes de asignar otro`,
      );
    }
  }

  async assertNoDuplicateAccessoryTypeForMainDevice(
    tx: Prisma.TransactionClient,
    mainDeviceId: string,
    catalogType: DeviceType,
    excludeDeviceId?: string,
  ) {
    const conflict = await tx.deviceItem.findFirst({
      where: {
        mainDeviceId,
        catalog: { type: catalogType },
        ...(excludeDeviceId && { id: { not: excludeDeviceId } }),
      },
    });
    if (conflict) {
      throw new BadRequestException(
        `Esta computadora ya tiene un accesorio de tipo ${catalogType} enlazado (${conflict.internalCode}); libérelo antes de enlazar otro`,
      );
    }
  }

  async getDeviceOrThrow(id: string) {
    const device = await this.prisma.deviceItem.findUnique({
      where: { id },
      include: { catalog: true },
    });
    if (!device) {
      throw new NotFoundException(`DeviceItem with ID '${id}' not found`);
    }
    return device;
  }

  async assertEmployeeInBranch(employeeId: string, branchId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with ID '${employeeId}' not found`);
    }
    if (employee.branchId !== branchId) {
      throw new BadRequestException('El empleado pertenece a otra sucursal');
    }
    if (!employee.isActive) {
      throw new BadRequestException(
        'No se puede asignar equipo a un empleado dado de baja',
      );
    }
  }

  async assertLocationInBranch(locationId: string, branchId: string) {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });
    if (!location) {
      throw new NotFoundException(`Location with ID '${locationId}' not found`);
    }
    if (location.branchId !== branchId) {
      throw new BadRequestException('La ubicación pertenece a otra sucursal');
    }
  }
}
