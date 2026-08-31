import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { FindEmployeesDto } from './dto/find-employees.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';
import { assertBranchAccess, BranchScopedUser, userBranchFilter } from 'src/common/utils/branch-access.util';
import { DevicesService } from 'src/devices/devices.service';
import { SafeguardsService } from 'src/safeguards/safeguards.service';
import { VehiclesService } from 'src/vehicles/vehicles.service';
import { VehicleSafeguardsService } from 'src/vehicle-safeguards/vehicle-safeguards.service';

const EMPLOYEE_ALLOWED_FIELDS = ['name', 'department', 'hasSignedResponsibility', 'createdAt'];

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devicesService: DevicesService,
    private readonly safeguardsService: SafeguardsService,
    private readonly vehiclesService: VehiclesService,
    private readonly vehicleSafeguardsService: VehicleSafeguardsService,
  ) {}

  async create(createEmployeeDto: CreateEmployeeDto, user: BranchScopedUser) {
    assertBranchAccess(user, createEmployeeDto.branchId);

    try {
      return await this.prisma.employee.create({ data: createEmployeeDto });
    } catch (error) {
      handleDatabaseErrors(error, 'Employee');
    }
  }

  async findAll(dto: FindEmployeesDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'department'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: EMPLOYEE_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
      ...(dto.department && { department: dto.department }),
      ...(!dto.includeInactive && { isActive: true }),
    } as Prisma.EmployeeWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({ skip, take, where: finalWhere, orderBy }),
      this.prisma.employee.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });

    if (!employee) {
      throw new NotFoundException(`Employee with ID '${id}' not found`);
    }

    return employee;
  }

  async update(id: string, updateEmployeeDto: UpdateEmployeeDto, user: BranchScopedUser) {
    const employee = await this.findOne(id);
    assertBranchAccess(user, employee.branchId);

    if (updateEmployeeDto.branchId) {
      assertBranchAccess(user, updateEmployeeDto.branchId);
    }

    try {
      return await this.prisma.employee.update({
        where: { id },
        data: updateEmployeeDto,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Employee');
    }
  }

  // Baja de un empleado: libera todo su equipo asignado, sin importar quién
  // lo administre (IT o Flotilla), con historial de movimiento por cada
  // equipo/vehículo; cierra ambos resguardos vigentes (sin generar uno
  // nuevo, ya no tiene nada que resguardar) y lo archiva (isActive: false)
  // en vez de eliminarlo — preserva su historial de resguardos.
  async offboard(id: string, user: BranchScopedUser & { id: string }) {
    const employee = await this.findOne(id);
    assertBranchAccess(user, employee.branchId);

    const reason = `Baja de empleado: ${employee.name}`;

    return this.prisma.$transaction(async (tx) => {
      await this.devicesService.releaseAllForEmployee(tx, id, reason);
      await this.safeguardsService.closeCurrentForEmployee(tx, id);
      await this.vehiclesService.releaseAllForEmployee(tx, id, reason);
      await this.vehicleSafeguardsService.closeCurrentForEmployee(tx, id);
      return tx.employee.update({ where: { id }, data: { isActive: false } });
    });
  }

  async remove(id: string, user: BranchScopedUser) {
    const employee = await this.findOne(id);
    assertBranchAccess(user, employee.branchId);

    // Chequeo explícito (con mensaje claro para la UI) en vez de dejar que
    // truene el FK constraint: un empleado con resguardos (vigentes o
    // históricos, de IT o de vehículo) no se puede eliminar por integridad
    // referencial.
    const [safeguardCount, vehicleSafeguardCount] = await Promise.all([
      this.prisma.safeguard.count({ where: { employeeId: id } }),
      this.prisma.vehicleSafeguard.count({ where: { employeeId: id } }),
    ]);
    if (safeguardCount > 0 || vehicleSafeguardCount > 0) {
      throw new BadRequestException(
        'No se puede eliminar: este empleado tiene resguardos (vigentes o históricos). ' +
          'Use POST /employees/:id/offboard para dar de baja en su lugar.',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Runs before the delete and touches `status` explicitly: the FK's
        // onDelete: SetNull only nulls employeeId once the row is gone, it
        // has no notion of the `status` enum, so this can't be done after.
        await tx.deviceItem.updateMany({
          where: { employeeId: id },
          data: { employeeId: null, status: 'AVAILABLE' },
        });
        await tx.vehicleItem.updateMany({
          where: { employeeId: id },
          data: { employeeId: null, status: 'AVAILABLE' },
        });

        return tx.employee.delete({ where: { id } });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Employee');
    }
  }
}
