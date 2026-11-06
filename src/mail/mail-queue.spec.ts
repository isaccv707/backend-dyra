import { Job, Queue } from 'bullmq';
import { redisConnectionFromUrl } from 'src/common/utils/redis-connection.util';
import {
  MAIL_JOB_OPTIONS,
  MailJob,
  MailQueueService,
} from './mail-queue.service';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';

describe('cola de correos', () => {
  const job: MailJob = {
    type: 'ticketUpdate',
    to: 'tech@dyra.com',
    data: {
      ticketId: 'ticket-1',
      code: 42,
      title: 'No enciende el monitor',
      heading: 'Tu ticket fue resuelto',
      message: 'Listo',
    },
  };

  describe('MailQueueService', () => {
    it('encola el trabajo con reintentos', () => {
      const queue = { add: jest.fn().mockResolvedValue({}) };
      new MailQueueService(queue as unknown as Queue).enqueue(job);

      expect(queue.add).toHaveBeenCalledWith(
        'ticketUpdate',
        job,
        MAIL_JOB_OPTIONS,
      );
    });

    it('no lanza si Redis falla', async () => {
      const queue = { add: jest.fn().mockRejectedValue(new Error('down')) };
      const service = new MailQueueService(queue as unknown as Queue);

      expect(() => service.enqueue(job)).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  describe('MailProcessor', () => {
    const mailService = {
      sendTicketAssignedEmail: jest.fn().mockResolvedValue(undefined),
      sendNewTicketEmail: jest.fn().mockResolvedValue(undefined),
      sendTicketUpdateEmail: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new MailProcessor(mailService as unknown as MailService);

    it('despacha cada tipo al método de MailService', async () => {
      await processor.process({ data: job } as Job<MailJob>);

      expect(mailService.sendTicketUpdateEmail).toHaveBeenCalledWith(
        'tech@dyra.com',
        job.data,
      );
    });

    it('propaga el error para que BullMQ reintente', async () => {
      mailService.sendTicketUpdateEmail.mockRejectedValueOnce(
        new Error('SMTP caído'),
      );

      await expect(
        processor.process({ data: job } as Job<MailJob>),
      ).rejects.toThrow('SMTP caído');
    });
  });

  describe('redisConnectionFromUrl', () => {
    it('traduce la URL a opciones de ioredis', () => {
      expect(
        redisConnectionFromUrl(
          'rediss://default:p%40ss@redis.example.com:6380/2',
        ),
      ).toEqual({
        host: 'redis.example.com',
        port: 6380,
        username: 'default',
        password: 'p@ss',
        db: 2,
        tls: {},
        family: 0,
        maxRetriesPerRequest: null,
      });
    });

    it('usa el puerto 6379 por defecto', () => {
      expect(redisConnectionFromUrl('redis://localhost')).toEqual({
        host: 'localhost',
        port: 6379,
        family: 0,
        maxRetriesPerRequest: null,
      });
    });
  });
});
