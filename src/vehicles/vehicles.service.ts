import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { AssignVehicleDto } from './dto/assign-vehicle.dto';
import { CancelVehicleTransferDto } from './dto/cancel-vehicle-transfer.dto';
import { CreateVehicleItemDto } from './dto/create-vehicle-item.dto';
import { CreateVehicleTransferDto } from './dto/create-vehicle-transfer.dto';
import { FindVehicleMovementHistoryDto } from './dto/find-vehicle-movement-history.dto';
import { FindVehicleTransfersDto } from './dto/find-vehicle-transfers.dto';
import { FindVehiclesDto } from './dto/find-vehicles.dto';
import { RejectVehicleTransferDto } from './dto/reject-vehicle-transfer.dto';
import { RetireVehicleDto } from './dto/retire-vehicle.dto';
import { UpdateVehicleItemDto } from './dto/update-vehicle-item.dto';
import { VehicleAssignmentService } from './services/vehicle-assignment.service';
import { VehicleQueryService } from './services/vehicle-query.service';
import { VehicleTransferService } from './services/vehicle-transfer.service';
import { VehicleWriteService } from './services/vehicle-write.service';
import { AuthUser } from './types/vehicle.types';

/**
 * Entry point of the vehicles domain for controllers and other modules. Holds
 * no logic: each operation lives in the sub-service of its responsibility.
 */
@Injectable()
export class VehiclesService {
  constructor(
    private readonly write: VehicleWriteService,
    private readonly query: VehicleQueryService,
    private readonly assignments: VehicleAssignmentService,
    private readonly transfers: VehicleTransferService,
  ) {}

  // Writes

  create(dto: CreateVehicleItemDto, user: AuthUser) {
    return this.write.create(dto, user);
  }

  update(id: string, dto: UpdateVehicleItemDto, user: AuthUser) {
    return this.write.update(id, dto, user);
  }

  // Reads

  findAll(dto: FindVehiclesDto, user: BranchScopedUser) {
    return this.query.findAll(dto, user);
  }

  findOne(id: string) {
    return this.query.findOne(id);
  }

  findMovementHistory(vehicleId: string, dto: FindVehicleMovementHistoryDto) {
    return this.query.findMovementHistory(vehicleId, dto);
  }

  // Assignments

  assign(vehicleId: string, dto: AssignVehicleDto, user: AuthUser) {
    return this.assignments.assign(vehicleId, dto, user);
  }

  unassign(vehicleId: string, user: BranchScopedUser) {
    return this.assignments.unassign(vehicleId, user);
  }

  retire(vehicleId: string, dto: RetireVehicleDto, user: BranchScopedUser) {
    return this.assignments.retire(vehicleId, dto, user);
  }

  releaseAllForEmployee(
    tx: Prisma.TransactionClient,
    employeeId: string,
    reason: string,
  ) {
    return this.assignments.releaseAllForEmployee(tx, employeeId, reason);
  }

  // Transfers

  createTransfer(dto: CreateVehicleTransferDto, user: BranchScopedUser) {
    return this.transfers.createTransfer(dto, user);
  }

  initiateTransfer(id: string, user: BranchScopedUser) {
    return this.transfers.initiateTransfer(id, user);
  }

  receiveTransfer(id: string, user: BranchScopedUser) {
    return this.transfers.receiveTransfer(id, user);
  }

  cancelTransfer(
    id: string,
    dto: CancelVehicleTransferDto,
    user: BranchScopedUser,
  ) {
    return this.transfers.cancelTransfer(id, dto, user);
  }

  rejectTransfer(
    id: string,
    dto: RejectVehicleTransferDto,
    user: BranchScopedUser,
  ) {
    return this.transfers.rejectTransfer(id, dto, user);
  }

  findTransfers(dto: FindVehicleTransfersDto, user: BranchScopedUser) {
    return this.transfers.findTransfers(dto, user);
  }

  findOneTransfer(id: string) {
    return this.transfers.findOneTransfer(id);
  }
}
