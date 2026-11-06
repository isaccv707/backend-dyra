import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { CreateSafeguardDto } from './dto/create-safeguard.dto';
import { FindSafeguardsDto } from './dto/find-safeguards.dto';
import { SignSafeguardDto } from './dto/sign-safeguard.dto';
import { SafeguardGenerationService } from './services/safeguard-generation.service';
import { SafeguardPdfService } from './services/safeguard-pdf.service';
import { SafeguardRecordsService } from './services/safeguard-records.service';
import { SafeguardSignatureService } from './services/safeguard-signature.service';
import {
  CreateFromEmployeeDevicesInput,
  SafeguardWithDetails,
} from './types/safeguard.types';

export type { CreateFromEmployeeDevicesInput } from './types/safeguard.types';

/**
 * Entry point of device safeguards (ADM.F.18) for the controller and other
 * modules. Holds no logic: each operation lives in `services/`.
 */
@Injectable()
export class SafeguardsService {
  constructor(
    private readonly generation: SafeguardGenerationService,
    private readonly records: SafeguardRecordsService,
    private readonly signatures: SafeguardSignatureService,
    private readonly pdf: SafeguardPdfService,
  ) {}

  createFromEmployeeDevices(
    tx: Prisma.TransactionClient,
    employeeId: string,
    input: CreateFromEmployeeDevicesInput,
  ): Promise<SafeguardWithDetails> {
    return this.generation.createFromEmployeeDevices(tx, employeeId, input);
  }

  closeCurrentForEmployee(tx: Prisma.TransactionClient, employeeId: string) {
    return this.generation.closeCurrentForEmployee(tx, employeeId);
  }

  create(dto: CreateSafeguardDto, user: BranchScopedUser & { id: string }) {
    return this.records.create(dto, user);
  }

  findAll(dto: FindSafeguardsDto, user: BranchScopedUser) {
    return this.records.findAll(dto, user);
  }

  findOne(id: string, user: BranchScopedUser): Promise<SafeguardWithDetails> {
    return this.records.findOne(id, user);
  }

  remove(id: string, user: BranchScopedUser) {
    return this.records.remove(id, user);
  }

  sign(
    id: string,
    dto: SignSafeguardDto,
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
    safeguard: SafeguardWithDetails,
  ): void {
    this.pdf.buildSafeguardPdf(doc, safeguard);
  }
}
