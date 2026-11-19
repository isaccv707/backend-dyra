import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from 'prisma/prisma/prisma.service';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { AttendancePunchService } from './attendance-punch.service';
import { PunchAttendanceDto } from '../dto/punch-attendance.dto';

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const RECORD_ID = '22222222-2222-4222-8222-222222222222';
const HOUR = 60 * 60 * 1000;

const user = {
  id: 'user-1',
  name: 'Recepción',
  branches: [{ id: BRANCH_ID, name: 'Centro' }],
} as RequestUser;
const supervisor = {
  id: 'sup-1',
  name: 'Supervisor',
  branches: [{ id: BRANCH_ID, name: 'Centro' }],
} as RequestUser;

const branch = {
  id: BRANCH_ID,
  name: 'Centro',
  isActive: true,
  latitude: 20.676944,
  longitude: -103.347222,
  geofenceRadiusM: 150,
};

const punchDto = (
  overrides: Partial<PunchAttendanceDto> = {},
): PunchAttendanceDto => ({
  type: 'CHECK_IN',
  branchId: BRANCH_ID,
  latitude: branch.latitude,
  longitude: branch.longitude,
  accuracyM: 12,
  ...overrides,
});

describe('AttendancePunchService', () => {
  let service: AttendancePunchService;
  let prisma: {
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
    branch: { findUnique: jest.Mock; findMany: jest.Mock };
    user: { findUnique: jest.Mock };
    attendanceRecord: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      branch: {
        findUnique: jest.fn().mockResolvedValue(branch),
        findMany: jest.fn().mockResolvedValue([branch]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          isActive: true,
          branches: [{ id: BRANCH_ID }],
        }),
      },
      attendanceRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(({ data }: { data: unknown }) => Promise.resolve(data)),
        update: jest.fn(({ data }: { data: unknown }) => Promise.resolve(data)),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AttendancePunchService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AttendancePunchService);
  });

  describe('punch', () => {
    it('stores a VALID check-in with server time and request meta', async () => {
      const result = await service.punch(punchDto(), user, {
        ipAddress: '10.0.0.1',
        userAgent: 'jest',
      });

      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(result).toMatchObject({
        type: 'CHECK_IN',
        source: 'DEVICE',
        status: 'VALID',
        withinGeofence: true,
        flags: [],
        userId: user.id,
        branchId: BRANCH_ID,
        ipAddress: '10.0.0.1',
        userAgent: 'jest',
      });
      expect(result!.recordedAt).toBeInstanceOf(Date);
    });

    it('stores FLAGGED instead of rejecting outside the geofence', async () => {
      const result = await service.punch(
        punchDto({ latitude: 20.673236, longitude: -103.358964 }),
        user,
        {},
      );
      expect(result).toMatchObject({
        status: 'FLAGGED',
        withinGeofence: false,
        flags: ['OUTSIDE_GEOFENCE'],
      });
    });

    it('rejects a second check-in while one is open (409)', async () => {
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        type: 'CHECK_IN',
        recordedAt: new Date(Date.now() - 2 * HOUR),
      });
      await expect(service.punch(punchDto(), user, {})).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
    });

    it('rejects a check-out without an open check-in (409)', async () => {
      await expect(
        service.punch(punchDto({ type: 'CHECK_OUT' }), user, {}),
      ).rejects.toThrow('No tienes una entrada abierta');
    });

    it('rejects a branch outside the user scope (403)', async () => {
      await expect(
        service.punch(punchDto({ branchId: OTHER_BRANCH_ID }), user, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an inactive branch (404)', async () => {
      prisma.branch.findUnique.mockResolvedValue({
        ...branch,
        isActive: false,
      });
      await expect(service.punch(punchDto(), user, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getStatus', () => {
    it('offers CHECK_OUT while a check-in is open', async () => {
      const recordedAt = new Date(Date.now() - HOUR);
      prisma.attendanceRecord.findFirst.mockResolvedValue({
        type: 'CHECK_IN',
        recordedAt,
      });
      const status = await service.getStatus(user);
      expect(status).toMatchObject({
        nextType: 'CHECK_OUT',
        openSince: recordedAt,
      });
      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, id: { in: [BRANCH_ID] } },
        }),
      );
    });
  });

  describe('createManual', () => {
    const manual = {
      userId: user.id,
      branchId: BRANCH_ID,
      type: 'CHECK_OUT' as const,
      recordedAt: new Date(Date.now() - HOUR).toISOString(),
      reason: 'Olvidó checar su salida',
    };

    it('creates a MANUAL punch that fits the sequence', async () => {
      prisma.attendanceRecord.findFirst
        .mockResolvedValueOnce({ type: 'CHECK_IN', recordedAt: new Date(0) })
        .mockResolvedValueOnce(null);
      const result = await service.createManual(manual, supervisor);
      expect(result).toMatchObject({
        source: 'MANUAL',
        createdById: supervisor.id,
        adjustmentReason: manual.reason,
      });
    });

    it('rejects a punch that breaks the sequence (409)', async () => {
      prisma.attendanceRecord.findFirst
        .mockResolvedValueOnce({ type: 'CHECK_OUT', recordedAt: new Date(0) })
        .mockResolvedValueOnce(null);
      await expect(service.createManual(manual, supervisor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('forbids manual punches for oneself', async () => {
      await expect(
        service.createManual({ ...manual, userId: supervisor.id }, supervisor),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('adjust', () => {
    const stored = {
      id: RECORD_ID,
      userId: user.id,
      branchId: BRANCH_ID,
      status: 'FLAGGED',
      recordedAt: new Date('2026-10-13T15:10:00Z'),
      originalRecordedAt: null,
    };

    beforeEach(() => {
      prisma.attendanceRecord.findUnique.mockResolvedValue(stored);
    });

    it('approves without a new time (VALID)', async () => {
      const result = await service.adjust(
        RECORD_ID,
        { reason: 'Visita a domicilio' },
        supervisor,
      );
      expect(result).toMatchObject({
        status: 'VALID',
        adjustedById: supervisor.id,
      });
    });

    it('moves the time keeping the original (ADJUSTED)', async () => {
      prisma.attendanceRecord.findFirst
        .mockResolvedValueOnce({
          type: 'CHECK_OUT',
          recordedAt: new Date('2026-10-12T23:00:00Z'),
        })
        .mockResolvedValueOnce({
          type: 'CHECK_OUT',
          recordedAt: new Date('2026-10-13T23:00:00Z'),
        });
      const result = await service.adjust(
        RECORD_ID,
        { recordedAt: '2026-10-13T15:00:00Z', reason: 'Llegó a las 9:00' },
        supervisor,
      );
      expect(result).toMatchObject({
        status: 'ADJUSTED',
        originalRecordedAt: stored.recordedAt,
        recordedAt: new Date('2026-10-13T15:00:00Z'),
      });
    });

    it('rejects a time that reorders punches (409)', async () => {
      prisma.attendanceRecord.findFirst
        .mockResolvedValueOnce({
          type: 'CHECK_OUT',
          recordedAt: new Date('2026-10-12T23:00:00Z'),
        })
        .mockResolvedValueOnce({
          type: 'CHECK_OUT',
          recordedAt: new Date('2026-10-13T23:00:00Z'),
        });
      await expect(
        service.adjust(
          RECORD_ID,
          { recordedAt: '2026-10-14T01:00:00Z', reason: 'Hora equivocada' },
          supervisor,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('forbids reviewing own punches', async () => {
      await expect(
        service.adjust(RECORD_ID, { reason: 'Me equivoqué' }, user),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
