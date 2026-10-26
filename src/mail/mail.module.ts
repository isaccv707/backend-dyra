import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailQueueService, MAIL_QUEUE } from './mail-queue.service';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';

@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [MailService, MailQueueService, MailProcessor],
  exports: [MailService, MailQueueService],
})
export class MailModule {}
