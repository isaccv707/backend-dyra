import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import {
  DEVICE_ALLOWED_FIELDS,
  DEVICE_INCLUDE,
} from '../constants/device-includes.const';
import { FindDevicesDto } from '../dto/find-devices.dto';
import { FindMovementHistoryDto } from '../dto/find-movement-history.dto';
import { DeviceValidationService } from './device-validation.service';

/** Reads of devices and their movement history. */
@Injectable()
export class DeviceQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: DeviceValidationService,
  ) {}

  async findAll(dto: FindDevicesDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['internalCode', 'serialNumber', 'imei'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: DEVICE_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...this.branchScopedWhere('currentBranchId', user, dto.branchId),
      ...(dto.status && { status: dto.status }),
      ...(dto.employeeId && { employeeId: dto.employeeId }),
      ...(dto.locationId && { locationId: dto.locationId }),
      ...(dto.catalogId && { catalogId: dto.catalogId }),
    } as Prisma.DeviceItemWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.deviceItem.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: DEVICE_INCLUDE,
      }),
      this.prisma.deviceItem.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string) {
    const device = await this.prisma.deviceItem.findUnique({
      where: { id },
      include: DEVICE_INCLUDE,
    });

    if (!device) {
      throw new NotFoundException(`DeviceItem with ID '${id}' not found`);
    }

    return device;
  }

  async findMovementHistory(deviceId: string, dto: FindMovementHistoryDto) {
    await this.validation.getDeviceOrThrow(deviceId);

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 10;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.deviceMovementHistory.findMany({
        where: { deviceId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.deviceMovementHistory.count({ where: { deviceId } }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  private branchScopedWhere(
    field: string,
    user: BranchScopedUser,
    branchId?: string,
  ) {
    const { branchId: condition } = userBranchFilter(user, branchId) as {
      branchId?: unknown;
    };
    return condition !== undefined ? { [field]: condition } : {};
  }
}
