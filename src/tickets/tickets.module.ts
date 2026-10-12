import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { MailModule } from 'src/mail/mail.module';
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
    MailModule,
    ScheduleModule.forRoot(),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
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
