import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceSource,
  AttendanceStatus,
  AttendanceType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  AdjustAttendanceDto,
  CreateManualAttendanceDto,
} from '../dto/manual-attendance.dto';
import { PunchAttendanceDto } from '../dto/punch-attendance.dto';
import { ATTENDANCE_RECORD_INCLUDE } from '../attendance.shared';
import { evaluateLocation, nextPunchType } from '../utils/punch-rules.util';

export interface PunchRequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

const BRANCH_GEOFENCE_SELECT = {
  id: true,
  name: true,
  latitude: true,
  longitude: true,
  geofenceRadiusM: true,
} satisfies Prisma.BranchSelect;

const SEQUENCE_ERROR =
  'La checada rompe la secuencia de entradas y salidas del usuario';

/** Punches (self and manual) and supervisor review. */
@Injectable()
export class AttendancePunchService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(user: RequestUser) {
    const now = new Date();
    const branchIds = user.branches.map((b) => b.id);

    const [last, branches] = await Promise.all([
      this.prisma.attendanceRecord.findFirst({
        where: { userId: user.id },
        orderBy: { recordedAt: 'desc' },
        include: ATTENDANCE_RECORD_INCLUDE,
      }),
      this.prisma.branch.findMany({
        where: {
          isActive: true,
          ...(branchIds.length > 0 && { id: { in: branchIds } }),
        },
        select: BRANCH_GEOFENCE_SELECT,
        orderBy: { name: 'asc' },
      }),
    ]);

    const nextType = nextPunchType(last, now);
    return {
      nextType,
      lastRecord: last,
      openSince:
        nextType === AttendanceType.CHECK_OUT ? last!.recordedAt : null,
      branches,
    };
  }

  async punch(
    dto: PunchAttendanceDto,
    user: RequestUser,
    meta: PunchRequestMeta,
  ) {
    assertBranchAccess(user, dto.branchId);
    const branch = await this.findActiveBranch(dto.branchId);

    const now = new Date();
    const clientTimestamp = dto.clientTimestamp
      ? new Date(dto.clientTimestamp)
      : null;
    const location = evaluateLocation(branch, { ...dto, clientTimestamp }, now);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, user.id);

        const last = await tx.attendanceRecord.findFirst({
          where: { userId: user.id },
          orderBy: { recordedAt: 'desc' },
          select: { type: true, recordedAt: true },
        });
        if (nextPunchType(last, now) !== dto.type) {
          throw new ConflictException(
            dto.type === AttendanceType.CHECK_IN
              ? 'Ya tienes una entrada registrada. Registra tu salida primero.'
              : 'No tienes una entrada abierta. Registra tu entrada primero.',
          );
        }

        return tx.attendanceRecord.create({
          data: {
            type: dto.type,
            source: AttendanceSource.DEVICE,
            status:
              location.flags.length > 0
                ? AttendanceStatus.FLAGGED
                : AttendanceStatus.VALID,
            recordedAt: now,
            clientTimestamp,
            latitude: dto.latitude,
            longitude: dto.longitude,
            accuracyM: dto.accuracyM,
            distanceM: location.distanceM,
            withinGeofence: location.withinGeofence,
            flags: location.flags,
            notes: dto.notes?.trim() || null,
            ipAddress: meta.ipAddress ?? null,
            userAgent: meta.userAgent?.slice(0, 500) ?? null,
            userId: user.id,
            branchId: branch.id,
          },
          include: ATTENDANCE_RECORD_INCLUDE,
        });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'AttendanceRecord');
    }
  }

  async createManual(dto: CreateManualAttendanceDto, user: RequestUser) {
    assertBranchAccess(user, dto.branchId);
    if (dto.userId === user.id) {
      throw new ForbiddenException(
        'No puedes registrar checadas manuales para ti mismo',
      );
    }
    await this.findActiveBranch(dto.branchId);
    await this.assertUserBelongsToBranch(dto.userId, dto.branchId);

    const recordedAt = new Date(dto.recordedAt);
    this.assertNotFuture(recordedAt);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, dto.userId);
        const { prev, next } = await this.findNeighbors(
          tx,
          dto.userId,
          recordedAt,
        );
        if (prev?.type === dto.type || next?.type === dto.type) {
          throw new ConflictException(SEQUENCE_ERROR);
        }

        return tx.attendanceRecord.create({
          data: {
            type: dto.type,
            source: AttendanceSource.MANUAL,
            status: AttendanceStatus.VALID,
            recordedAt,
            userId: dto.userId,
            branchId: dto.branchId,
            createdById: user.id,
            adjustmentReason: dto.reason.trim(),
          },
          include: ATTENDANCE_RECORD_INCLUDE,
        });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'AttendanceRecord');
    }
  }

  async adjust(id: string, dto: AdjustAttendanceDto, user: RequestUser) {
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { id },
    });
    if (!record) throw new NotFoundException('Checada no encontrada');
    assertBranchAccess(user, record.branchId);
    if (record.userId === user.id) {
      throw new ForbiddenException('No puedes revisar tus propias checadas');
    }

    const review = {
      adjustedById: user.id,
      adjustedAt: new Date(),
      adjustmentReason: dto.reason.trim(),
    };

    if (!dto.recordedAt) {
      return this.prisma.attendanceRecord.update({
        where: { id },
        data: {
          ...review,
          status:
            record.status === AttendanceStatus.ADJUSTED
              ? AttendanceStatus.ADJUSTED
              : AttendanceStatus.VALID,
        },
        include: ATTENDANCE_RECORD_INCLUDE,
      });
    }

    const recordedAt = new Date(dto.recordedAt);
    this.assertNotFuture(recordedAt);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, record.userId);
        const { prev, next } = await this.findNeighbors(
          tx,
          record.userId,
          record.recordedAt,
          id,
        );
        const keepsOrder =
          (!prev || prev.recordedAt < recordedAt) &&
          (!next || recordedAt < next.recordedAt);
        if (!keepsOrder) {
          throw new ConflictException(
            'La nueva hora debe quedar entre la checada anterior y la siguiente del usuario',
          );
        }

        return tx.attendanceRecord.update({
          where: { id },
          data: {
            ...review,
            recordedAt,
            originalRecordedAt: record.originalRecordedAt ?? record.recordedAt,
            status: AttendanceStatus.ADJUSTED,
          },
          include: ATTENDANCE_RECORD_INCLUDE,
        });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'AttendanceRecord');
    }
  }

  /** Serializes punches of one user (double click, two tabs). */
  private async lockUser(tx: Prisma.TransactionClient, userId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attendance:${userId}`}))`;
  }

  private async findNeighbors(
    tx: Prisma.TransactionClient,
    userId: string,
    at: Date,
    excludeId?: string,
  ) {
    const base = {
      userId,
      ...(excludeId && { id: { not: excludeId } }),
    };
    const select = { type: true, recordedAt: true } as const;
    const [prev, next] = await Promise.all([
      tx.attendanceRecord.findFirst({
        where: { ...base, recordedAt: { lt: at } },
        orderBy: { recordedAt: 'desc' },
        select,
      }),
      tx.attendanceRecord.findFirst({
        where: { ...base, recordedAt: { gt: at } },
        orderBy: { recordedAt: 'asc' },
        select,
      }),
    ]);
    return { prev, next };
  }

  private async findActiveBranch(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { ...BRANCH_GEOFENCE_SELECT, isActive: true },
    });
    if (!branch || !branch.isActive) {
      throw new NotFoundException('Sucursal no encontrada o inactiva');
    }
    return branch;
  }

  private async assertUserBelongsToBranch(userId: string, branchId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, branches: { select: { id: true } } },
    });
    if (!target || !target.isActive) {
      throw new NotFoundException('Usuario no encontrado o inactivo');
    }
    const hasAccess =
      target.branches.length === 0 ||
      target.branches.some((b) => b.id === branchId);
    if (!hasAccess) {
      throw new ForbiddenException(
        'El usuario no tiene acceso a esta sucursal',
      );
    }
  }

  private assertNotFuture(date: Date) {
    if (date.getTime() > Date.now()) {
      throw new BadRequestException('La checada no puede estar en el futuro');
    }
  }
}
