import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendancePunchService } from './services/attendance-punch.service';
import { AttendanceQueryService } from './services/attendance-query.service';
import { AttendanceExportService } from './services/attendance-export.service';
import { UserThrottlerGuard } from './guards/user-throttler.guard';

@Module({
  imports: [
    // Per-user guard against double taps / scripted punches (see @Throttle).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 6 }],
    }),
  ],
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    AttendancePunchService,
    AttendanceQueryService,
    AttendanceExportService,
    UserThrottlerGuard,
  ],
})
export class AttendanceModule {}
