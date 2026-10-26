import { Test } from '@nestjs/testing';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { MailQueueService } from 'src/mail/mail-queue.service';
import { MailService } from 'src/mail/mail.service';
import { TicketAssigneesService } from '../assignees/ticket-assignees.service';
import { TicketCommentsService } from '../comments/ticket-comments.service';
import { CreateTicketDto } from '../dto/create-ticket.dto';
import { TicketFormWorkflowService } from '../forms/ticket-form-workflow.service';
import { TicketFormsService } from '../forms/ticket-forms.service';
import { TicketNotificationsService } from '../notifications/ticket-notifications.service';
import { TicketSlaService } from '../sla/ticket-sla.service';
import { TicketsGateway } from '../tickets.gateway';
import { TicketsService } from '../tickets.service';

export const branchId = 'branch-1';

export const globalUser: RequestUser = {
  id: 'user-1',
  email: 'reportero@dyra.com',
  name: 'Reportero',
  isActive: true,
  branches: [],
  role: { id: 'role-1', name: 'Reportero', permissions: [] },
};
export const scopedUser: RequestUser = {
  ...globalUser,
  branches: [{ id: branchId, name: 'Sucursal 1' }],
};
export const staffUser: RequestUser = {
  id: 'staff-1',
  email: 'ti@dyra.com',
  name: 'TI',
  isActive: true,
  branches: [],
  role: { id: 'role-2', name: 'TI', permissions: ['tickets:update'] },
};
export const scopedStaffUser: RequestUser = {
  ...staffUser,
  branches: [{ id: branchId, name: 'Sucursal 1' }],
};

export const createDto: CreateTicketDto = {
  branchId,
  title: 'No enciende el monitor',
  description: 'El monitor de la sala 2 no enciende',
  category: 'HARDWARE',
} as CreateTicketDto;

const createPrismaMock = () => {
  const prisma = {
    ticket: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    ticketAssignee: { deleteMany: jest.fn(), createMany: jest.fn() },
    ticketComment: { create: jest.fn() },
    ticketNotification: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    ticketEvent: { create: jest.fn(), createMany: jest.fn() },
    ticketSubcategory: { findUnique: jest.fn() },
    ticketCounter: { upsert: jest.fn().mockResolvedValue({ lastCode: 7 }) },
    ticketForm: {
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    role: { findMany: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    // Interactive transactions run against the same mocks; array batches
    // (findAll) are mocked per test.
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prisma) => unknown)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  );
  return prisma;
};

/**
 * Every ticket service wired together over the same Prisma, gateway, mail and
 * form-handler mocks, so a spec can assert on any side effect of a flow.
 */
export async function createTicketsTestContext() {
  const prisma = createPrismaMock();
  const ticketForms = {
    parse: jest.fn(),
    apply: jest.fn(),
    isApplicable: jest.fn().mockReturnValue(true),
    upgrade: jest.fn((_type: string, _version: number, data: unknown) => data),
  };
  const gateway = {
    emitNewTicket: jest.fn(),
    emitTicketUpdated: jest.fn(),
    emitNewComment: jest.fn(),
    notifyUsers: jest.fn(),
    emitOverdueTicket: jest.fn(),
  };
  const mailService = {
    sendAccessGrantedEmail: jest.fn().mockResolvedValue(undefined),
  };
  const mailQueue = { enqueue: jest.fn() };

  const module = await Test.createTestingModule({
    providers: [
      TicketsService,
      TicketNotificationsService,
      TicketCommentsService,
      TicketAssigneesService,
      TicketFormWorkflowService,
      TicketSlaService,
      { provide: PrismaService, useValue: prisma },
      { provide: TicketsGateway, useValue: gateway },
      { provide: MailService, useValue: mailService },
      { provide: MailQueueService, useValue: mailQueue },
      { provide: TicketFormsService, useValue: ticketForms },
    ],
  }).compile();

  return {
    prisma,
    ticketForms,
    gateway,
    mailService,
    mailQueue,
    ticketsService: module.get(TicketsService),
    notificationsService: module.get(TicketNotificationsService),
    commentsService: module.get(TicketCommentsService),
    assigneesService: module.get(TicketAssigneesService),
    formWorkflowService: module.get(TicketFormWorkflowService),
    slaService: module.get(TicketSlaService),
  };
}

export type TicketsTestContext = Awaited<
  ReturnType<typeof createTicketsTestContext>
>;
