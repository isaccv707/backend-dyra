import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  NewTicketEmailData,
  TicketAssignedEmailData,
  TicketUpdateEmailData,
} from './mail.service';

export const MAIL_QUEUE = 'mail';

/** Emails sent in the background, with retries. */
export type MailJob =
  | { type: 'ticketAssigned'; to: string; data: TicketAssignedEmailData }
  | { type: 'newTicket'; to: string; data: NewTicketEmailData }
  | { type: 'ticketUpdate'; to: string; data: TicketUpdateEmailData };

/** 5 tries over ~15 min (30 s, 1, 2, 4, 8 min); failed jobs stay in Redis to review. */
export const MAIL_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

@Injectable()
export class MailQueueService {
  private readonly logger = new Logger(MailQueueService.name);

  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue) {}

  /**
   * Fire-and-forget: never throws nor waits on Redis (while it's down the job
   * waits in the client's offline queue), so the request is never held up.
   */
  enqueue(job: MailJob): void {
    this.queue.add(job.type, job, MAIL_JOB_OPTIONS).catch((error: unknown) => {
      this.logger.error(
        `No se pudo encolar el correo ${job.type} a ${job.to}: ${(error as Error).message}`,
      );
    });
  }
}
