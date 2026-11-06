import { Injectable } from '@nestjs/common';
import { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { AssignPriceSheetDto } from './dto/assign-price-sheet.dto';
import { CreateStudyDto, StudyPriceDto } from './dto/create-study.dto';
import { PaginationDto } from './dto/pagination-study.dto';
import { SetPanelItemsDto } from './dto/set-panel-items.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { StudyExportService } from './services/study-export.service';
import { StudyPanelService } from './services/study-panel.service';
import { StudyPriceService } from './services/study-price.service';
import { StudyQueryService } from './services/study-query.service';
import {
  CreatableStudyDto,
  StudyValidationService,
} from './services/study-validation.service';
import { StudyWriteService } from './services/study-write.service';
import { StudyDb } from './types/study-db.type';

export type { StudyDb } from './types/study-db.type';
export { toStudyResponse } from './utils/study-mappers.util';

/**
 * Entry point of the studies domain for controllers and other modules. Holds no
 * logic: each operation lives in the sub-service of its responsibility.
 */
@Injectable()
export class StudiesService {
  constructor(
    private readonly validation: StudyValidationService,
    private readonly write: StudyWriteService,
    private readonly query: StudyQueryService,
    private readonly panels: StudyPanelService,
    private readonly prices: StudyPriceService,
    private readonly exporter: StudyExportService,
  ) {}

  // Validation

  assertProvidersBelongToBranch(
    providerIds: string[],
    branchId: string,
    db?: StudyDb,
  ) {
    return this.validation.assertProvidersBelongToBranch(
      providerIds,
      branchId,
      db,
    );
  }

  assertPriceSheetsBelongToBranch(
    priceSheetIds: string[],
    branchId: string,
    db?: StudyDb,
  ) {
    return this.validation.assertPriceSheetsBelongToBranch(
      priceSheetIds,
      branchId,
      db,
    );
  }

  assertCreatableMany(
    items: { label: string; dto: CreatableStudyDto }[],
    branchId: string,
    db?: StudyDb,
  ) {
    return this.validation.assertCreatableMany(items, branchId, db);
  }

  assertCreatable(dto: CreatableStudyDto, db?: StudyDb) {
    return this.validation.assertCreatable(dto, db);
  }

  assertUpdatable(
    id: string,
    updateStudyDto: UpdateStudyDto,
    user: BranchScopedUser,
    db?: StudyDb,
    options?: { childrenWillBeRemoved?: boolean },
  ) {
    return this.validation.assertUpdatable(
      id,
      updateStudyDto,
      user,
      db,
      options,
    );
  }

  // Writes

  createMany(
    items: { label: string; dto: CreateStudyDto }[],
    user: BranchScopedUser,
    db?: StudyDb,
  ) {
    return this.write.createMany(items, user, db);
  }

  create(createStudyDto: CreateStudyDto, user: BranchScopedUser, db?: StudyDb) {
    return this.write.create(createStudyDto, user, db);
  }

  update(
    id: string,
    updateStudyDto: UpdateStudyDto,
    user: BranchScopedUser,
    db?: StudyDb,
  ) {
    return this.write.update(id, updateStudyDto, user, db);
  }

  remove(id: string, user: BranchScopedUser) {
    return this.write.remove(id, user);
  }

  // Reads

  findAll(dto: PaginationDto) {
    return this.query.findAll(dto);
  }

  findAdminActive(dto: PaginationDto, user: BranchScopedUser) {
    return this.query.findAdminActive(dto, user);
  }

  findInactive(dto: PaginationDto, user: BranchScopedUser) {
    return this.query.findInactive(dto, user);
  }

  findOrderable(dto: PaginationDto) {
    return this.query.findOrderable(dto);
  }

  findAdminOrderable(dto: PaginationDto, user: BranchScopedUser) {
    return this.query.findAdminOrderable(dto, user);
  }

  findOne(id: string) {
    return this.query.findOne(id);
  }

  findAdminOne(id: string, user: BranchScopedUser) {
    return this.query.findAdminOne(id, user);
  }

  findInactiveOne(id: string, user: BranchScopedUser) {
    return this.query.findInactiveOne(id, user);
  }

  findBySlug(slug: string, branchId: string) {
    return this.query.findBySlug(slug, branchId);
  }

  // Panels

  getPanelTree(id: string) {
    return this.panels.getPanelTree(id);
  }

  assertValidPanelChildren(
    panelId: string | null,
    branchId: string,
    childIds: string[],
    db?: StudyDb,
  ) {
    return this.panels.assertValidPanelChildren(
      panelId,
      branchId,
      childIds,
      db,
    );
  }

  setPanelItems(
    id: string,
    dto: SetPanelItemsDto,
    user: BranchScopedUser,
    tx?: StudyDb,
  ) {
    return this.panels.setPanelItems(id, dto, user, tx);
  }

  // Prices

  replacePrices(
    studyId: string,
    prices: StudyPriceDto[],
    user: BranchScopedUser,
    db?: StudyDb,
  ) {
    return this.prices.replacePrices(studyId, prices, user, db);
  }

  assignPriceSheet(
    studyId: string,
    dto: AssignPriceSheetDto,
    user: BranchScopedUser,
  ) {
    return this.prices.assignPriceSheet(studyId, dto, user);
  }

  removePriceSheet(
    studyId: string,
    priceSheetId: string,
    user: BranchScopedUser,
  ) {
    return this.prices.removePriceSheet(studyId, priceSheetId, user);
  }

  // Export

  exportByBranch(branchId: string, user: BranchScopedUser) {
    return this.exporter.exportByBranch(branchId, user);
  }
}
