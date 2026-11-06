import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { AssignDeviceDto } from './dto/assign-device.dto';
import { CancelTransferDto } from './dto/cancel-transfer.dto';
import { CreateDeviceItemDto } from './dto/create-device-item.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { FindDevicesDto } from './dto/find-devices.dto';
import { FindMovementHistoryDto } from './dto/find-movement-history.dto';
import { FindTransfersDto } from './dto/find-transfers.dto';
import { RejectTransferDto } from './dto/reject-transfer.dto';
import { RetireDeviceDto } from './dto/retire-device.dto';
import { UpdateDeviceItemDto } from './dto/update-device-item.dto';
import { DeviceAssignmentService } from './services/device-assignment.service';
import { DeviceQueryService } from './services/device-query.service';
import { DeviceTransferService } from './services/device-transfer.service';
import { DeviceWriteService } from './services/device-write.service';
import { AuthUser } from './types/device.types';

/**
 * Entry point of the devices domain for controllers and other modules. Holds no
 * logic: each operation lives in the sub-service of its responsibility.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly write: DeviceWriteService,
    private readonly query: DeviceQueryService,
    private readonly assignments: DeviceAssignmentService,
    private readonly transfers: DeviceTransferService,
  ) {}

  // Writes

  create(dto: CreateDeviceItemDto, user: AuthUser) {
    return this.write.create(dto, user);
  }

  update(id: string, dto: UpdateDeviceItemDto, user: AuthUser) {
    return this.write.update(id, dto, user);
  }

  // Reads

  findAll(dto: FindDevicesDto, user: BranchScopedUser) {
    return this.query.findAll(dto, user);
  }

  findOne(id: string) {
    return this.query.findOne(id);
  }

  findMovementHistory(deviceId: string, dto: FindMovementHistoryDto) {
    return this.query.findMovementHistory(deviceId, dto);
  }

  // Assignments

  assign(deviceId: string, dto: AssignDeviceDto, user: AuthUser) {
    return this.assignments.assign(deviceId, dto, user);
  }

  unassign(deviceId: string, user: BranchScopedUser) {
    return this.assignments.unassign(deviceId, user);
  }

  unlink(deviceId: string, user: AuthUser) {
    return this.assignments.unlink(deviceId, user);
  }

  retire(deviceId: string, dto: RetireDeviceDto, user: BranchScopedUser) {
    return this.assignments.retire(deviceId, dto, user);
  }

  releaseAllForEmployee(
    tx: Prisma.TransactionClient,
    employeeId: string,
    reason: string,
  ) {
    return this.assignments.releaseAllForEmployee(tx, employeeId, reason);
  }

  // Transfers

  createTransfer(dto: CreateTransferDto, user: BranchScopedUser) {
    return this.transfers.createTransfer(dto, user);
  }

  initiateTransfer(id: string, user: BranchScopedUser) {
    return this.transfers.initiateTransfer(id, user);
  }

  receiveTransfer(id: string, user: BranchScopedUser) {
    return this.transfers.receiveTransfer(id, user);
  }

  cancelTransfer(id: string, dto: CancelTransferDto, user: BranchScopedUser) {
    return this.transfers.cancelTransfer(id, dto, user);
  }

  rejectTransfer(id: string, dto: RejectTransferDto, user: BranchScopedUser) {
    return this.transfers.rejectTransfer(id, dto, user);
  }

  findTransfers(dto: FindTransfersDto, user: BranchScopedUser) {
    return this.transfers.findTransfers(dto, user);
  }

  findOneTransfer(id: string) {
    return this.transfers.findOneTransfer(id);
  }
}
