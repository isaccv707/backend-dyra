import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { TicketsController } from './tickets.controller';
import { TicketsGateway } from './tickets.gateway';
import { TicketsService } from './tickets.service';
import { TicketsSlaCron } from './tickets-sla.cron';
import { TicketSubcategoriesController } from './subcategories/ticket-subcategories.controller';
import { TicketSubcategoriesService } from './subcategories/ticket-subcategories.service';
import { TicketsAnalyticsController } from './analytics/tickets-analytics.controller';
import { TicketsAnalyticsService } from './analytics/tickets-analytics.service';
import { TicketAnalyticsPdfRenderer } from './analytics/ticket-analytics-pdf.renderer';

@Module({
  imports: [
    PrismaModule,
    // Registra la infraestructura de @nestjs/schedule para TicketsSlaCron
    // (aviso por hora de tickets con SLA vencido). Solo este módulo la usa.
    ScheduleModule.forRoot(),
    // Mismo secreto que AuthModule (JWT_SECRET) para que el gateway pueda
    // verificar el mismo token que emite POST /auth/login.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    // Solo se usa vía @UseGuards(ThrottlerGuard) en los endpoints puntuales
    // de tickets.controller.ts (crear ticket, comentar) — no se registra
    // como APP_GUARD, así que no afecta a ningún otro módulo. Se agrupa por
    // usuario autenticado (ver getTracker), no por IP: varios usuarios de la
    // misma sucursal/oficina comparten salida a internet y no deben
    // bloquearse entre sí.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 30 }],
      getTracker: (req: Record<string, unknown>) => {
        const user = req.user as { id?: string } | undefined;
        return Promise.resolve(user?.id ?? (req.ip as string));
      },
    }),
  ],
  controllers: [
    TicketsController,
    TicketSubcategoriesController,
    TicketsAnalyticsController,
  ],
  providers: [
    TicketsGateway,
    TicketsService,
    TicketsSlaCron,
    TicketSubcategoriesService,
    TicketsAnalyticsService,
    TicketAnalyticsPdfRenderer,
  ],
  exports: [TicketsService],
})
export class TicketsModule {}
