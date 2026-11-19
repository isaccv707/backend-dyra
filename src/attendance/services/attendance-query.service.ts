import { Injectable } from '@nestjs/common';
import { AttendanceStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import {
  assertBranchAccess,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import { MAX_SHIFT_MS } from '../attendance.constants';
import {
  ATTENDANCE_RECORD_INCLUDE,
  AttendanceRecordWithRelations,
  resolveRange,
  ResolvedRange,
} from '../attendance.shared';
import {
  AttendanceRangeDto,
  AttendanceSummaryQueryDto,
  AttendanceUsersQueryDto,
  FindAttendanceDto,
} from '../dto/find-attendance.dto';
import { buildWorkSessions, WorkSession } from '../utils/work-sessions.util';

const SORTABLE_FIELDS = ['recordedAt', 'createdAt', 'user.name'];

export interface AttendanceDayRow {
  userId: string;
  userName: string;
  date: string;
  firstCheckIn: Date | null;
  lastCheckOut: Date | null;
  workedMinutes: number;
  sessions: number;
  incomplete: boolean;
  inProgress: boolean;
  flaggedCount: number;
}

export interface AttendanceUserTotal {
  userId: string;
  userName: string;
  workedMinutes: number;
  daysWorked: number;
  incompleteSessions: number;
  flaggedCount: number;
}

/** Read side: lists, own history and per-day summaries. */
@Injectable()
export class AttendanceQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(dto: FindAttendanceDto, user: RequestUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['user.name'],
      defaultSort: { recordedAt: 'desc' },
      allowedFields: SORTABLE_FIELDS,
    });

    const range =
      dto.from || dto.to ? resolveRange(dto.from, dto.to) : undefined;

    const finalWhere: Prisma.AttendanceRecordWhereInput = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
      ...(dto.userId && { userId: dto.userId }),
      ...(dto.status && { status: dto.status }),
      ...(dto.type && { type: dto.type }),
      ...(dto.source && { source: dto.source }),
      ...(range && { recordedAt: { gte: range.gte, lt: range.lt } }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: ATTENDANCE_RECORD_INCLUDE,
      }),
      this.prisma.attendanceRecord.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findMine(dto: AttendanceRangeDto, user: RequestUser) {
    const range = resolveRange(dto.from, dto.to);
    const records = await this.fetchForSessions(range, { userId: user.id });
    const sessions = this.sessionsInRange(records, range).reverse();

    return {
      from: range.from,
      to: range.to,
      totalWorkedMinutes: sessions.reduce((sum, s) => sum + s.workedMinutes, 0),
      sessions,
    };
  }

  async summary(dto: AttendanceSummaryQueryDto, user: RequestUser) {
    const range = resolveRange(dto.from, dto.to);
    const records = await this.fetchForSessions(range, {
      ...userBranchFilter(user, dto.branchId),
      ...(dto.userId && { userId: dto.userId }),
    });

    const byUser = new Map<string, AttendanceRecordWithRelations[]>();
    for (const record of records) {
      const list = byUser.get(record.userId) ?? [];
      list.push(record);
      byUser.set(record.userId, list);
    }

    const days: AttendanceDayRow[] = [];
    const users: AttendanceUserTotal[] = [];

    for (const [userId, userRecords] of byUser) {
      const userName = userRecords[0].user.name;
      const sessions = this.sessionsInRange(userRecords, range);
      if (sessions.length === 0) continue;

      const userDays = this.groupByDay(userId, userName, sessions);
      days.push(...userDays);
      users.push({
        userId,
        userName,
        workedMinutes: userDays.reduce((sum, d) => sum + d.workedMinutes, 0),
        daysWorked: userDays.filter((d) => d.workedMinutes > 0).length,
        incompleteSessions: sessions.filter((s) => s.incomplete).length,
        flaggedCount: userDays.reduce((sum, d) => sum + d.flaggedCount, 0),
      });
    }

    days.sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        a.userName.localeCompare(b.userName, 'es'),
    );
    users.sort((a, b) => a.userName.localeCompare(b.userName, 'es'));

    return { from: range.from, to: range.to, days, users };
  }

  /** Active users that can punch in the branch (or in the user's branches). */
  async listUsers(dto: AttendanceUsersQueryDto, user: RequestUser) {
    if (dto.branchId) assertBranchAccess(user, dto.branchId);
    const allowedIds = user.branches.map((b) => b.id);

    const branchWhere: Prisma.UserWhereInput = dto.branchId
      ? { branches: { some: { id: dto.branchId } } }
      : allowedIds.length > 0
        ? { branches: { some: { id: { in: allowedIds } } } }
        : {};

    return this.prisma.user.findMany({
      where: {
        isActive: true,
        ...branchWhere,
        role: { permissions: { some: { action: 'attendance:check' } } },
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Records of the range plus a MAX_SHIFT_MS margin on both sides, so sessions
   * crossing the range edges still pair.
   */
  private fetchForSessions(
    range: ResolvedRange,
    where: Prisma.AttendanceRecordWhereInput,
  ) {
    return this.prisma.attendanceRecord.findMany({
      where: {
        ...where,
        recordedAt: {
          gte: new Date(range.gte.getTime() - MAX_SHIFT_MS),
          lt: new Date(range.lt.getTime() + MAX_SHIFT_MS),
        },
      },
      orderBy: { recordedAt: 'asc' },
      include: ATTENDANCE_RECORD_INCLUDE,
    });
  }

  private sessionsInRange(
    records: AttendanceRecordWithRelations[],
    range: ResolvedRange,
  ) {
    return buildWorkSessions(records).filter(
      (s) => s.date >= range.from && s.date <= range.to,
    );
  }

  private groupByDay(
    userId: string,
    userName: string,
    sessions: WorkSession<AttendanceRecordWithRelations>[],
  ): AttendanceDayRow[] {
    const byDate = new Map<string, AttendanceDayRow>();

    for (const s of sessions) {
      const row = byDate.get(s.date) ?? {
        userId,
        userName,
        date: s.date,
        firstCheckIn: null,
        lastCheckOut: null,
        workedMinutes: 0,
        sessions: 0,
        incomplete: false,
        inProgress: false,
        flaggedCount: 0,
      };

      row.sessions += 1;
      row.workedMinutes += s.workedMinutes;
      row.incomplete ||= s.incomplete;
      row.inProgress ||= s.inProgress;
      if (
        s.checkIn &&
        (!row.firstCheckIn || s.checkIn.recordedAt < row.firstCheckIn)
      ) {
        row.firstCheckIn = s.checkIn.recordedAt;
      }
      if (
        s.checkOut &&
        (!row.lastCheckOut || s.checkOut.recordedAt > row.lastCheckOut)
      ) {
        row.lastCheckOut = s.checkOut.recordedAt;
      }
      row.flaggedCount += [s.checkIn, s.checkOut].filter(
        (r) => r?.status === AttendanceStatus.FLAGGED,
      ).length;

      byDate.set(s.date, row);
    }

    return [...byDate.values()];
  }
}
