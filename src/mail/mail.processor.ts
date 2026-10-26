import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MAIL_QUEUE, MailJob } from './mail-queue.service';
import { MailService } from './mail.service';

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<MailJob>): Promise<void> {
    const mail = job.data;
    switch (mail.type) {
      case 'ticketAssigned':
        return this.mailService.sendTicketAssignedEmail(mail.to, mail.data);
      case 'newTicket':
        return this.mailService.sendNewTicketEmail(mail.to, mail.data);
      case 'ticketUpdate':
        return this.mailService.sendTicketUpdateEmail(mail.to, mail.data);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<MailJob> | undefined, error: Error) {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    const final = job.attemptsMade >= attempts;
    const message = `Correo ${job.data.type} a ${job.data.to} falló (intento ${job.attemptsMade}/${attempts}): ${error.message}`;
    if (final) {
      this.logger.error(`${message}. Sin más reintentos.`);
    } else {
      this.logger.warn(message);
    }
  }
}
