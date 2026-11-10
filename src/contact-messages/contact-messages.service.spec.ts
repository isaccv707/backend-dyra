import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { MailQueueService } from 'src/mail/mail-queue.service';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { ContactMessagesService } from './contact-messages.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

const user = {
  id: 'user-1',
  name: 'Recepción',
  branches: [{ id: BRANCH_ID, name: 'Centro' }],
} as RequestUser;
const outsider = {
  id: 'user-2',
  name: 'Otra',
  branches: [{ id: 'other-branch', name: 'Otra' }],
} as RequestUser;

const dto: CreateContactMessageDto = {
  branchId: BRANCH_ID,
  name: 'Ana López',
  email: 'ana@correo.com',
  phone: '3312345678',
  subject: 'HOME_SAMPLING',
  message: 'Quiero una toma a domicilio el sábado.',
  privacyAccepted: true,
};

const stored = {
  id: MESSAGE_ID,
  folio: 7,
  ...dto,
  status: 'NEW',
  privacyAcceptedAt: new Date(),
};

describe('ContactMessagesService', () => {
  let service: ContactMessagesService;
  let mailQueue: { enqueue: jest.Mock };
  let prisma: {
    $transaction: jest.Mock;
    branch: { findUnique: jest.Mock };
    user: { findMany: jest.Mock };
    contactMessage: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    mailQueue = { enqueue: jest.fn() };
    prisma = {
      $transaction: jest.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
      branch: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: BRANCH_ID, name: 'Centro', isActive: true }),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { email: 'a@dyra.com' },
            { email: 'b@dyra.com' },
          ]),
      },
      contactMessage: {
        create: jest.fn().mockResolvedValue(stored),
        findMany: jest.fn().mockResolvedValue([stored]),
        findUnique: jest.fn().mockResolvedValue(stored),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(stored),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        ContactMessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailQueueService, useValue: mailQueue },
      ],
    }).compile();

    service = module.get(ContactMessagesService);
  });

  describe('create', () => {
    it('guarda el mensaje como NEW con historial y devuelve el folio', async () => {
      const result = await service.create(dto);

      expect(result).toEqual({ received: true, folio: 7 });
      const { data } = prisma.contactMessage.create.mock.calls[0][0];
      expect(data).toMatchObject({
        branchId: BRANCH_ID,
        name: 'Ana López',
        subject: 'HOME_SAMPLING',
        history: { create: { toStatus: 'NEW' } },
      });
      expect(data.privacyAcceptedAt).toBeInstanceOf(Date);
      expect(data).not.toHaveProperty('privacyAccepted');
      expect(data).not.toHaveProperty('website');
    });

    it('avisa por correo a cada responsable de la sucursal', async () => {
      await service.create(dto);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            role: {
              permissions: { some: { action: 'contact-messages:update' } },
            },
          }),
        }),
      );
      expect(mailQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(mailQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'newContactMessage',
          to: 'a@dyra.com',
          data: expect.objectContaining({
            folio: 7,
            branchName: 'Centro',
            subjectLabel: 'Tomas a domicilio',
          }),
        }),
      );
    });

    it('no falla el envío si la notificación falla', async () => {
      prisma.user.findMany.mockRejectedValue(new Error('db down'));

      await expect(service.create(dto)).resolves.toEqual({
        received: true,
        folio: 7,
      });
    });

    it('descarta en silencio lo que llena el honeypot', async () => {
      const result = await service.create({ ...dto, website: 'http://spam' });

      expect(result).toEqual({ received: true });
      expect(prisma.contactMessage.create).not.toHaveBeenCalled();
      expect(mailQueue.enqueue).not.toHaveBeenCalled();
    });

    it('rechaza una sucursal inexistente o inactiva', async () => {
      prisma.branch.findUnique.mockResolvedValue({
        id: BRANCH_ID,
        name: 'Centro',
        isActive: false,
      });

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
      expect(prisma.contactMessage.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('limita a las sucursales del usuario y aplica filtros', async () => {
      await service.findAll({ status: 'NEW', subject: 'OTHER' }, user);

      expect(prisma.contactMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            branchId: { in: [BRANCH_ID] },
            status: 'NEW',
            subject: 'OTHER',
          }),
        }),
      );
    });

    it('rechaza una sucursal ajena', async () => {
      await expect(
        service.findAll({ branchId: BRANCH_ID }, outsider),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it('cuenta solo los NEW de las sucursales del usuario', async () => {
    await expect(service.countPending(user)).resolves.toEqual({ count: 1 });
    expect(prisma.contactMessage.count).toHaveBeenCalledWith({
      where: { status: 'NEW', branchId: { in: [BRANCH_ID] } },
    });
  });

  describe('findOne', () => {
    it('404 si no existe', async () => {
      prisma.contactMessage.findUnique.mockResolvedValue(null);
      await expect(service.findOne(MESSAGE_ID, user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('403 si es de otra sucursal', async () => {
      await expect(service.findOne(MESSAGE_ID, outsider)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('updateStatus', () => {
    it('cambia el estatus y registra quién lo hizo', async () => {
      await service.updateStatus(
        MESSAGE_ID,
        { status: 'IN_PROGRESS', note: 'Se le llamó' },
        user,
      );

      expect(prisma.contactMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MESSAGE_ID },
          data: {
            status: 'IN_PROGRESS',
            history: {
              create: {
                fromStatus: 'NEW',
                toStatus: 'IN_PROGRESS',
                note: 'Se le llamó',
                changedById: 'user-1',
              },
            },
          },
        }),
      );
    });

    it('permite solo agregar una nota sin cambiar estatus', async () => {
      await service.updateStatus(
        MESSAGE_ID,
        { status: 'NEW', note: 'No contesta' },
        user,
      );
      expect(prisma.contactMessage.update).toHaveBeenCalled();
    });

    it('rechaza el mismo estatus sin nota', async () => {
      await expect(
        service.updateStatus(MESSAGE_ID, { status: 'NEW' }, user),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.contactMessage.update).not.toHaveBeenCalled();
    });

    it('403 si es de otra sucursal', async () => {
      await expect(
        service.updateStatus(MESSAGE_ID, { status: 'RESOLVED' }, outsider),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
