import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { CreateVehicleSafeguardDto } from './dto/create-vehicle-safeguard.dto';
import { FindVehicleSafeguardsDto } from './dto/find-vehicle-safeguards.dto';
import { SignVehicleSafeguardDto } from './dto/sign-vehicle-safeguard.dto';
import { VehicleSafeguardGenerationService } from './services/vehicle-safeguard-generation.service';
import { VehicleSafeguardPdfService } from './services/vehicle-safeguard-pdf.service';
import { VehicleSafeguardRecordsService } from './services/vehicle-safeguard-records.service';
import { VehicleSafeguardSignatureService } from './services/vehicle-safeguard-signature.service';
import {
  CreateFromEmployeeVehicleInput,
  VehicleSafeguardWithDetails,
} from './types/vehicle-safeguard.types';

export type { CreateFromEmployeeVehicleInput } from './types/vehicle-safeguard.types';

/**
 * Entry point of vehicle safeguards (ADM.F.01) for the controller and other
 * modules. Holds no logic: each operation lives in `services/`.
 */
@Injectable()
export class VehicleSafeguardsService {
  constructor(
    private readonly generation: VehicleSafeguardGenerationService,
    private readonly records: VehicleSafeguardRecordsService,
    private readonly signatures: VehicleSafeguardSignatureService,
    private readonly pdf: VehicleSafeguardPdfService,
  ) {}

  createFromEmployeeVehicle(
    tx: Prisma.TransactionClient,
    employeeId: string,
    input: CreateFromEmployeeVehicleInput,
  ): Promise<VehicleSafeguardWithDetails> {
    return this.generation.createFromEmployeeVehicle(tx, employeeId, input);
  }

  closeCurrentForEmployee(tx: Prisma.TransactionClient, employeeId: string) {
    return this.generation.closeCurrentForEmployee(tx, employeeId);
  }

  create(
    dto: CreateVehicleSafeguardDto,
    user: BranchScopedUser & { id: string },
  ) {
    return this.records.create(dto, user);
  }

  findAll(dto: FindVehicleSafeguardsDto, user: BranchScopedUser) {
    return this.records.findAll(dto, user);
  }

  findOne(
    id: string,
    user: BranchScopedUser,
  ): Promise<VehicleSafeguardWithDetails> {
    return this.records.findOne(id, user);
  }

  remove(id: string, user: BranchScopedUser) {
    return this.records.remove(id, user);
  }

  sign(
    id: string,
    dto: SignVehicleSafeguardDto,
    user: BranchScopedUser & { id: string },
  ) {
    return this.signatures.sign(id, dto, user);
  }

  getSignedDocumentUrl(id: string, user: BranchScopedUser) {
    return this.signatures.getSignedDocumentUrl(id, user);
  }

  createUploadSignature(id: string, user: BranchScopedUser) {
    return this.signatures.createUploadSignature(id, user);
  }

  buildSafeguardPdf(
    doc: PDFKit.PDFDocument,
    safeguard: VehicleSafeguardWithDetails,
  ): void {
    this.pdf.buildSafeguardPdf(doc, safeguard);
  }
}
