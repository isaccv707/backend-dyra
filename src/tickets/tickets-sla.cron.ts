import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TicketsService } from './tickets.service';

@Injectable()
export class TicketsSlaCron {
  private readonly logger = new Logger(TicketsSlaCron.name);

  constructor(private readonly ticketsService: TicketsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleOverdueTickets() {
    const { notified } = await this.ticketsService.notifyOverdueTickets();
    if (notified > 0) {
      this.logger.log(
        `Avisos de SLA vencido enviados para ${notified} ticket(s).`,
      );
    }
  }
}
