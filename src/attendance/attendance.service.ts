import { Injectable } from '@nestjs/common';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import {
  AdjustAttendanceDto,
  CreateManualAttendanceDto,
} from './dto/manual-attendance.dto';
import { PunchAttendanceDto } from './dto/punch-attendance.dto';
import {
  AttendanceRangeDto,
  AttendanceSummaryQueryDto,
  AttendanceUsersQueryDto,
  FindAttendanceDto,
} from './dto/find-attendance.dto';
import {
  AttendancePunchService,
  PunchRequestMeta,
} from './services/attendance-punch.service';
import { AttendanceQueryService } from './services/attendance-query.service';
import { AttendanceExportService } from './services/attendance-export.service';

/** Logic-free façade: the controller only talks to this service. */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly punches: AttendancePunchService,
    private readonly query: AttendanceQueryService,
    private readonly exporter: AttendanceExportService,
  ) {}

  getStatus(user: RequestUser) {
    return this.punches.getStatus(user);
  }

  punch(dto: PunchAttendanceDto, user: RequestUser, meta: PunchRequestMeta) {
    return this.punches.punch(dto, user, meta);
  }

  createManual(dto: CreateManualAttendanceDto, user: RequestUser) {
    return this.punches.createManual(dto, user);
  }

  adjust(id: string, dto: AdjustAttendanceDto, user: RequestUser) {
    return this.punches.adjust(id, dto, user);
  }

  findAll(dto: FindAttendanceDto, user: RequestUser) {
    return this.query.findAll(dto, user);
  }

  findMine(dto: AttendanceRangeDto, user: RequestUser) {
    return this.query.findMine(dto, user);
  }

  summary(dto: AttendanceSummaryQueryDto, user: RequestUser) {
    return this.query.summary(dto, user);
  }

  listUsers(dto: AttendanceUsersQueryDto, user: RequestUser) {
    return this.query.listUsers(dto, user);
  }

  export(dto: AttendanceSummaryQueryDto, user: RequestUser) {
    return this.exporter.export(dto, user);
  }
}
