import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { writeFileSync } from 'fs';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { MailService } from 'src/mail/mail.service';
import { MailJob, MailQueueService } from 'src/mail/mail-queue.service';
import { TicketNotificationsService } from 'src/tickets/notifications/ticket-notifications.service';
import { TicketNotificationEvent } from 'src/tickets/notifications/ticket-notification-rules';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { ensureE2eBaseData } from './support/e2e-seed';

/**
 * Ticket notices end to end against a real database: who gets each event
 * in-app and by email (TICKET_NOTIFICATION_RULES), muted emails, and the
 * user's inbox (`/tickets/notifications*`). The mail queue is mocked and its
 * jobs are recorded. Creates its own branches, users and tickets and deletes
 * them afterwards. Only the suite's own users are traced: global TI or
 * administrators of the local database may also receive notices. With
 * TICKET_NOTIFICATIONS_E2E_TRACE=<path> it writes every normalized response
 * to a file, to compare behavior before and after a refactor.
 */
describe('Tickets: avisos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `e2e-${Date.now().toString(36)}`;
  const password = `E2e-${Math.random().toString(36).slice(2)}!`;
  const mailQueue = { enqueue: jest.fn() };
  const ids = {
    branchA: '',
    branchB: '',
    addressIds: [] as number[],
    userIds: [] as string[],
  };
  const users: Record<string, { id: string; token: string }> = {};

  const trace: unknown[] = [];
  const labels = new Map<string, string>();
  const normalize = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value ?? null)
        .replace(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
          (id) => labels.get(id) ?? '<id>',
        )
        .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<date>')
        .split(tag)
        .join('<tag>'),
    ) as unknown;
  const byJson = (a: unknown, b: unknown) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b));

  type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
  const call = async (
    name: string,
    expected: number,
    as: string,
    method: Method,
    url: string,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())
      [method](`/api${url}`)
      .set('Authorization', `Bearer ${users[as].token}`);
    const res = await (body ? req.send(body) : req);
    trace.push({
      name,
      as,
      status: res.status,
      url: normalize(url),
      body: normalize(res.body),
    });
    expect({ name, status: res.status, body: res.body }).toMatchObject({
      name,
      status: expected,
    });
    return res.body as Record<string, any>;
  };

  /** Emails queued since the last call, to the suite's users only. */
  const emails = (name: string) => {
    const jobs = (mailQueue.enqueue.mock.calls as [MailJob][])
      .map(([job]) => job)
      .filter((job) => job.to.endsWith(`${tag}@example.com`));
    mailQueue.enqueue.mockClear();
    trace.push({ name, emails: (normalize(jobs) as unknown[]).sort(byJson) });
  };

  /** Every suite user's notices, in a stable order (same-ms ties). */
  const inboxes = async (name: string) => {
    const rows = await prisma.ticketNotification.findMany({
      where: { userId: { in: ids.userIds } },
      select: {
        userId: true,
        actorId: true,
        kind: true,
        message: true,
        read: true,
        ticket: { select: { code: true } },
      },
    });
    trace.push({ name, notices: (normalize(rows) as unknown[]).sort(byJson) });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({})
      .overrideProvider(MailQueueService)
      .useValue(mailQueue)
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await ensureE2eBaseData(prisma);

    const state = await prisma.state.findFirstOrThrow();
    const branch = async (name: string) => {
      const address = await prisma.address.create({
        data: { street: 'E2E', extNumber: '1', zipCode: '00000', city: 'E2E' },
      });
      ids.addressIds.push(address.id);
      const created = await prisma.branch.create({
        data: {
          name: `${name} ${tag}`,
          urlResults: 'https://example.com',
          stateId: state.id,
          addressId: address.id,
        },
      });
      labels.set(created.id, `<branch:${name}>`);
      return created.id;
    };
    ids.branchA = await branch('A');
    ids.branchB = await branch('B');

    const hash = await bcrypt.hash(password, 10);
    const user = async (key: string, role: string, branches: string[]) => {
      const email = `${key}.${tag}@example.com`;
      const created = await prisma.user.create({
        data: {
          email,
          name: `${key} ${tag}`,
          password: hash,
          role: { connect: { name: role } },
          branches: { connect: branches.map((id) => ({ id })) },
        },
      });
      ids.userIds.push(created.id);
      labels.set(created.id, `<user:${key}>`);
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
      users[key] = {
        id: created.id,
        token: (res.body as { access_token: string }).access_token,
      };
    };
    await user('ti', 'Administrador', [ids.branchA]);
    await user('admin2', 'Administrador', [ids.branchA]);
    await user('soporte', 'Soporte TI', [ids.branchA]);
    await user('soporteB', 'Soporte TI', [ids.branchB]);
    await user('ana', 'Usuario', [ids.branchA]);
    await user('beto', 'Usuario', [ids.branchA]);
  }, 60_000);

  afterAll(async () => {
    if (process.env.TICKET_NOTIFICATIONS_E2E_TRACE) {
      writeFileSync(
        process.env.TICKET_NOTIFICATIONS_E2E_TRACE,
        JSON.stringify(trace, null, 2),
      );
    }
    if (!prisma) return;
    const branchIds = [ids.branchA, ids.branchB];
    await prisma.ticket.deleteMany({ where: { branchId: { in: branchIds } } });
    await prisma.ticketCounter.deleteMany({
      where: { branchId: { in: branchIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    await prisma.address.deleteMany({ where: { id: { in: ids.addressIds } } });
    await app.close();
  }, 60_000);

  const ticket = (title: string) => ({
    branchId: ids.branchA,
    title: `${title} ${tag}`,
    description: `Descripción de ${title}`,
    category: 'HARDWARE',
  });

  it('reparte cada evento según sus reglas', async () => {
    const t1 = await call(
      'ana levanta t1',
      201,
      'ana',
      'post',
      '/tickets',
      ticket('Impresora'),
    );
    labels.set(t1.id, '<ticket:1>');
    emails('correos: ticket nuevo');

    await call(
      'preferencias iniciales',
      200,
      'soporte',
      'get',
      '/tickets/notification-preferences',
    );
    await call(
      'evento inválido',
      400,
      'soporte',
      'put',
      '/tickets/notification-preferences',
      { mutedEvents: ['NOPE'] },
    );
    await call(
      'silenciar ticket nuevo',
      200,
      'soporte',
      'put',
      '/tickets/notification-preferences',
      { mutedEvents: ['NEW_TICKET', 'SLA_WARNING'] },
    );
    const t2 = await call(
      'ana levanta t2',
      201,
      'ana',
      'post',
      '/tickets',
      ticket('Monitor'),
    );
    labels.set(t2.id, '<ticket:2>');
    emails('correos: ticket nuevo con soporte silenciado');

    await call(
      'asignar a soporte',
      200,
      'ti',
      'put',
      `/tickets/${t1.id}/assignees`,
      { userIds: [users.soporte.id] },
    );
    emails('correos: asignación');
    await call(
      'reasignar a beto',
      200,
      'ti',
      'put',
      `/tickets/${t1.id}/assignees`,
      { userIds: [users.beto.id] },
    );
    emails('correos: reasignación');

    await call(
      'comentario con mención',
      201,
      'ana',
      'post',
      `/tickets/${t1.id}/comments`,
      { body: 'Sigue fallando', mentionedUserIds: [users.ti.id] },
    );
    emails('correos: mención');
    await call(
      'nota interna',
      201,
      'ti',
      'post',
      `/tickets/${t1.id}/comments`,
      { body: 'Revisar driver', isInternal: true },
    );
    await call('cambio de prioridad', 200, 'ti', 'patch', `/tickets/${t1.id}`, {
      priority: 'HIGH',
    });
    await call('resolver', 200, 'ti', 'patch', `/tickets/${t1.id}`, {
      status: 'RESOLVED',
    });
    emails('correos: resuelto');

    // Events fired by the SLA cron and the form workflow.
    const notifications = app.get(TicketNotificationsService);
    const notifiable = async (id: string) => {
      const row = await prisma.ticket.findUniqueOrThrow({
        where: { id },
        include: { assignees: { select: { userId: true } } },
      });
      return { ...row, assigneeIds: row.assignees.map((a) => a.userId) };
    };
    const events: Array<[TicketNotificationEvent, string]> = [
      ['OVERDUE', t1.id],
      ['SLA_WARNING', t1.id],
      ['SLA_WARNING', t2.id],
      ['ESCALATION', t2.id],
      ['AUTO_CLOSED', t1.id],
      ['FORM_DECIDED', t2.id],
    ];
    for (const [event, id] of events) {
      await notifications.dispatch(event, await notifiable(id), {
        message: `Evento ${event}`,
      });
      emails(`correos: ${event} en ${labels.get(id)}`);
    }
    await notifications.dispatch('CHANGE', await notifiable(t2.id), {
      message: 'Cambio con actor excluido',
      actorId: users.ana.id,
      excludeUserIds: [users.ti.id],
    });
    await inboxes('avisos de todos los usuarios');
  });

  it('bandeja del usuario: filtrar, leer y limpiar', async () => {
    const inbox = '/tickets/notifications';
    const mine = await call(
      'ana: todas',
      200,
      'ana',
      'get',
      `${inbox}?limit=50&sort[field]=createdAt&sort[order]=asc`,
    );
    await call(
      'ana: no leídas',
      200,
      'ana',
      'get',
      `${inbox}?read=false&limit=1`,
    );
    await call('ana: búsqueda', 200, 'ana', 'get', `${inbox}?search=resuelto`);
    const first = (mine.data as { id: string }[])[0].id;
    const second = (mine.data as { id: string }[])[1].id;
    await call('leer ajena', 403, 'beto', 'patch', `${inbox}/${first}/read`);
    await call(
      'leer inexistente',
      404,
      'ana',
      'patch',
      `${inbox}/${ids.branchA}/read`,
    );
    await call('leer', 200, 'ana', 'patch', `${inbox}/${first}/read`);
    await call('ana: leídas', 200, 'ana', 'get', `${inbox}?read=true`);
    await call('borrar ajena', 403, 'beto', 'delete', `${inbox}/${second}`);
    await call(
      'borrar inexistente',
      404,
      'ana',
      'delete',
      `${inbox}/${ids.branchA}`,
    );
    await call('borrar', 200, 'ana', 'delete', `${inbox}/${second}`);
    await call('limpiar leídas', 200, 'ana', 'delete', inbox);
    await call('leer todas', 200, 'ana', 'patch', `${inbox}/read-all`);
    await call('leer todas otra vez', 200, 'ana', 'patch', `${inbox}/read-all`);
    await call('limpiar leídas otra vez', 200, 'ana', 'delete', inbox);
    await call('ana: vacía', 200, 'ana', 'get', inbox);
    await call(
      'beto: limpiar todas',
      200,
      'beto',
      'delete',
      `${inbox}?all=true`,
    );
    await call(
      'ti: no leídas',
      200,
      'ti',
      'get',
      `${inbox}?read=false&limit=50&sort[field]=createdAt&sort[order]=asc`,
    );
    await inboxes('avisos tras limpiar');
  });
});
