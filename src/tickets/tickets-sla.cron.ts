import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TicketNotificationsService } from './notifications/ticket-notifications.service';

@Injectable()
export class TicketsSlaCron {
  private readonly logger = new Logger(TicketsSlaCron.name);

  constructor(private readonly notifications: TicketNotificationsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOldNotifications() {
    const { deleted } = await this.notifications.purgeOld();
    if (deleted > 0) {
      this.logger.log(`Notificaciones leídas antiguas borradas: ${deleted}.`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleOverdueTickets() {
    const { notified } = await this.notifications.notifyOverdueTickets();
    if (notified > 0) {
      this.logger.log(
        `Avisos de SLA vencido enviados para ${notified} ticket(s).`,
      );
    }
  }
}
