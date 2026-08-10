import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { FindEmployeesDto } from './dto/find-employees.dto';
import { SetSignedResponsibilityDto } from './dto/set-signed-responsibility.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';
import { assertBranchAccess, BranchScopedUser, userBranchFilter } from 'src/common/utils/branch-access.util';

const EMPLOYEE_ALLOWED_FIELDS = ['name', 'department', 'hasSignedResponsibility', 'createdAt'];

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

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

  async setSignedResponsibility(id: string, dto: SetSignedResponsibilityDto, user: BranchScopedUser) {
    const employee = await this.findOne(id);
    assertBranchAccess(user, employee.branchId);

    try {
      return await this.prisma.employee.update({
        where: { id },
        data: { hasSignedResponsibility: dto.hasSignedResponsibility },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Employee');
    }
  }

  async remove(id: string, user: BranchScopedUser) {
    const employee = await this.findOne(id);
    assertBranchAccess(user, employee.branchId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Runs before the delete and touches `status` explicitly: the FK's
        // onDelete: SetNull only nulls employeeId once the row is gone, it
        // has no notion of the `status` enum, so this can't be done after.
        await tx.deviceItem.updateMany({
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
