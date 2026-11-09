import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { MailModule } from 'src/mail/mail.module';
import { ContactMessagesController } from './contact-messages.controller';
import { ContactMessagesService } from './contact-messages.service';

@Module({
  imports: [
    // Public form: per-IP flood guard (see @Throttle on POST).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 600_000, limit: 5 }],
    }),
    MailModule,
  ],
  controllers: [ContactMessagesController],
  providers: [ContactMessagesService],
})
export class ContactMessagesModule {}
