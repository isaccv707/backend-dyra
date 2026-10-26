import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TicketNotificationsService } from './notifications/ticket-notifications.service';
import { TicketSlaService } from './sla/ticket-sla.service';

@Injectable()
export class TicketsSlaCron {
  private readonly logger = new Logger(TicketsSlaCron.name);

  constructor(
    private readonly notifications: TicketNotificationsService,
    private readonly sla: TicketSlaService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOldNotifications() {
    const { deleted } = await this.notifications.purgeOld();
    if (deleted > 0) {
      this.logger.log(`Notificaciones leídas antiguas borradas: ${deleted}.`);
    }
  }

  /** Short SLAs (4 h) need finer steps than hourly to warn in time. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async runSlaLifecycle() {
    const steps = [
      ['Avisos de SLA por vencer', () => this.sla.warnSlaAboutToExpire()],
      ['Avisos de SLA vencido', () => this.sla.notifyOverdueTickets()],
      ['Escalamientos', () => this.sla.escalateUnassignedOverdue()],
      ['Cierres automáticos', () => this.sla.autoCloseResolved()],
    ] as const;

    // One failing step must not stop the others.
    for (const [label, run] of steps) {
      try {
        const result: Record<string, number> = await run();
        const total = Object.values(result)[0];
        if (total > 0) this.logger.log(`${label}: ${total}.`);
      } catch (error) {
        this.logger.error(`${label} falló: ${(error as Error).message}`);
      }
    }
  }
}
