import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';

/** Lookups and rules shared by vehicle writes and assignments. */
@Injectable()
export class VehicleValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async assertEmployeeHasNoActiveVehicle(
    tx: Prisma.TransactionClient,
    employeeId: string,
    excludeVehicleId?: string,
  ) {
    const conflict = await tx.vehicleItem.findFirst({
      where: {
        employeeId,
        status: DeviceStatus.ASSIGNED,
        ...(excludeVehicleId && { id: { not: excludeVehicleId } }),
      },
    });
    if (conflict) {
      throw new BadRequestException(
        `El empleado ya tiene un vehículo asignado (${conflict.internalCode}); libérelo antes de asignar otro`,
      );
    }
  }

  async getVehicleOrThrow(id: string) {
    const vehicle = await this.prisma.vehicleItem.findUnique({
      where: { id },
      include: { catalog: true },
    });
    if (!vehicle) {
      throw new NotFoundException(`VehicleItem with ID '${id}' not found`);
    }
    return vehicle;
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
        'No se puede asignar un vehículo a un empleado dado de baja',
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
