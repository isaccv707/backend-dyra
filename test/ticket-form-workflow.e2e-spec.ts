import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { writeFileSync } from 'fs';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { MailService } from 'src/mail/mail.service';
import { MailQueueService } from 'src/mail/mail-queue.service';
import { PrismaService } from 'prisma/prisma/prisma.service';

/**
 * Form workflow of a ticket (`/tickets/:id/form*`) end to end against a real
 * database, with the remote support form (encrypted TeamViewer password) and
 * the access request (creates a user and emails it). Study forms are covered
 * by tickets-forms.e2e-spec.ts. Creates its own branches and users and
 * deletes them afterwards. With TICKET_FORM_WORKFLOW_E2E_TRACE=<path> it
 * writes every normalized response to a file, to compare behavior before and
 * after a refactor.
 */
describe('Tickets: flujo de formularios (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `e2e-${Date.now().toString(36)}`;
  const password = `E2e-${Math.random().toString(36).slice(2)}!`;
  const mail = {
    sendAccessGrantedEmail: jest.fn().mockResolvedValue(undefined),
  };
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
        .replace(/"(addressId)":\d+/g, '"$1":"<n>"')
        // The access email goes out after the response (afterCommit): its flag
        // is checked explicitly instead of traced.
        .replace(/"emailSent":(true|false|null)/g, '"emailSent":"<async>"')
        .split(tag)
        .join('<tag>'),
    ) as unknown;

  type Method = 'get' | 'post' | 'patch';
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

  const emailSentOf = async (ticketId: string) => {
    for (let i = 0; i < 40; i++) {
      const form = await prisma.ticketForm.findUniqueOrThrow({
        where: { ticketId },
        select: { result: true },
      });
      const sent = (form.result as { emailSent?: boolean | null } | null)
        ?.emailSent;
      if (sent !== null && sent !== undefined) return sent;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .overrideProvider(MailQueueService)
      .useValue({ enqueue: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

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

    for (const role of await prisma.role.findMany()) {
      labels.set(role.id, `<role:${role.name}>`);
    }

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
    await user('soporte', 'Soporte TI', [ids.branchA]);
    await user('ana', 'Usuario', [ids.branchA]);
    await user('beto', 'Usuario', [ids.branchA]);
    await user('tec', 'Usuario', [ids.branchA]);
    await user('ajeno', 'Administrador', [ids.branchB]);
  }, 60_000);

  afterAll(async () => {
    if (process.env.TICKET_FORM_WORKFLOW_E2E_TRACE) {
      writeFileSync(
        process.env.TICKET_FORM_WORKFLOW_E2E_TRACE,
        JSON.stringify(trace, null, 2),
      );
    }
    if (!prisma) return;
    const branchIds = [ids.branchA, ids.branchB];
    await prisma.ticket.deleteMany({ where: { branchId: { in: branchIds } } });
    await prisma.ticketCounter.deleteMany({
      where: { branchId: { in: branchIds } },
    });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: ids.userIds } },
          { email: { endsWith: `${tag}@example.com` } },
        ],
      },
    });
    await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    await prisma.address.deleteMany({ where: { id: { in: ids.addressIds } } });
    await app.close();
  }, 60_000);

  it('soporte remoto: edición del formulario y contraseña cifrada', async () => {
    const { branchA } = ids;
    const remote = await call(
      'alta soporte remoto',
      201,
      'ana',
      'post',
      '/tickets',
      {
        branchId: branchA,
        title: `Excel no abre ${tag}`,
        description: 'Se cierra al abrir',
        category: 'SOFTWARE',
        form: { teamViewerId: '123 456 789', teamViewerPassword: 'clave-1' },
      },
    );
    labels.set(remote.id, '<ticket:remoto>');
    const plain = await call(
      'alta sin formulario',
      201,
      'ana',
      'post',
      '/tickets',
      {
        branchId: branchA,
        title: `Mouse ${tag}`,
        description: 'No funciona',
        category: 'HARDWARE',
      },
    );
    labels.set(plain.id, '<ticket:simple>');
    const secret = `/tickets/${remote.id}/form/secret`;
    const form = `/tickets/${remote.id}/form`;

    await call('contraseña con ticket abierto', 409, 'ti', 'get', secret);
    await call('en progreso', 200, 'ti', 'patch', `/tickets/${remote.id}`, {
      status: 'IN_PROGRESS',
    });
    await call('TI ve la contraseña', 200, 'ti', 'get', secret);
    await call('solicitante no la ve', 403, 'ana', 'get', secret);
    await call('no asignado no la ve', 403, 'tec', 'get', secret);
    await call('otra sucursal no la ve', 403, 'ajeno', 'get', secret);
    await prisma.ticketAssignee.create({
      data: { ticketId: remote.id, userId: users.tec.id },
    });
    await call('asignado la ve', 200, 'tec', 'get', secret);
    await call(
      'ticket inexistente',
      404,
      'ti',
      'get',
      `/tickets/${branchA}/form/secret`,
    );

    await call('solicitante edita', 200, 'ana', 'patch', form, {
      teamViewerId: '987',
      teamViewerPassword: 'clave-2',
    });
    await call('contraseña nueva', 200, 'tec', 'get', secret);
    await call('otro usuario no edita', 403, 'beto', 'patch', form, {
      teamViewerId: '1',
      teamViewerPassword: 'x',
    });
    await call('otra sucursal no edita', 403, 'ajeno', 'patch', form, {
      teamViewerId: '1',
      teamViewerPassword: 'x',
    });
    await call('datos inválidos', 400, 'ana', 'patch', form, {
      teamViewerId: '',
    });
    await call('TI edita', 200, 'ti', 'patch', form, {
      teamViewerId: '555',
      teamViewerPassword: 'clave-3',
    });
    await call(
      'sin formulario',
      400,
      'ana',
      'patch',
      `/tickets/${plain.id}/form`,
      { a: 1 },
    );
    await call('aprobar informativo', 400, 'ti', 'post', `${form}/apply`, {});
    await call(
      'validar informativo',
      400,
      'ti',
      'post',
      `${form}/validate`,
      {},
    );

    await call(
      'en espera borra la contraseña',
      200,
      'ti',
      'patch',
      `/tickets/${remote.id}`,
      { status: 'ON_HOLD' },
    );
    await call('contraseña en espera', 409, 'ti', 'get', secret);
    await call('registrar contraseña en espera', 400, 'ana', 'patch', form, {
      teamViewerId: '1',
      teamViewerPassword: 'x',
    });
    await call('reanudar', 200, 'ti', 'patch', `/tickets/${remote.id}`, {
      status: 'IN_PROGRESS',
    });
    await call('sin contraseña guardada', 404, 'ti', 'get', secret);
    await call('registrarla de nuevo', 200, 'ana', 'patch', form, {
      teamViewerId: '1',
      teamViewerPassword: 'clave-4',
    });
    await call('contraseña registrada de nuevo', 200, 'ti', 'get', secret);

    await call('rechazar sin motivo', 400, 'ti', 'post', `${form}/reject`, {});
    await call(
      'rechazar de otra sucursal',
      403,
      'ajeno',
      'post',
      `${form}/reject`,
      { reason: 'Motivo de prueba' },
    );
    await call('rechazar', 201, 'ti', 'post', `${form}/reject`, {
      reason: 'Se atendió por teléfono',
    });
    await call('rechazar dos veces', 409, 'ti', 'post', `${form}/reject`, {
      reason: 'Motivo de prueba',
    });
    await call('editar rechazado', 409, 'ana', 'patch', form, {
      teamViewerId: '1',
      teamViewerPassword: 'x',
    });
    await call('contraseña tras rechazo', 409, 'ti', 'get', secret);
    await call(
      'detalle final remoto',
      200,
      'ti',
      'get',
      `/tickets/${remote.id}`,
    );
    await call(
      'reenviar correo de otro formulario',
      400,
      'ti',
      'post',
      `${form}/resend-access-email`,
    );
  });

  it('solicitud de acceso: validar, aprobar y reenviar el correo', async () => {
    const { branchA } = ids;
    const usuario = await prisma.role.findUniqueOrThrow({
      where: { name: 'Usuario' },
    });
    const admin = await prisma.role.findUniqueOrThrow({
      where: { name: 'Administrador' },
    });
    const access = (fullName: string, email: string, roleId = usuario.id) => ({
      branchId: branchA,
      category: 'ACCESS',
      form: {
        fullName,
        email: `${email}.${tag}@example.com`,
        roleId,
        branchId: branchA,
      },
    });

    await call(
      'roles solicitables',
      200,
      'ana',
      'get',
      '/tickets/form-options/roles',
    );
    await call(
      'rol privilegiado',
      400,
      'ana',
      'post',
      '/tickets',
      access('Carla', 'carla', admin.id),
    );
    const t1 = await call(
      'solicitar acceso',
      201,
      'ana',
      'post',
      '/tickets',
      access('Carla Ruiz', 'carla'),
    );
    labels.set(t1.id, '<ticket:acceso>');
    const form = `/tickets/${t1.id}/form`;

    await call(
      'corregir nombre (cambia el título)',
      200,
      'ana',
      'patch',
      form,
      access('Carla Ruiz Paz', 'Carla').form,
    );
    await call('validar', 201, 'ti', 'post', `${form}/validate`, {});
    expect(
      await prisma.user.count({ where: { email: `carla.${tag}@example.com` } }),
    ).toBe(0);
    await call(
      'aprobar sin users:create',
      403,
      'soporte',
      'post',
      `${form}/apply`,
      {},
    );
    await call(
      'aprobar de otra sucursal',
      403,
      'ajeno',
      'post',
      `${form}/apply`,
      {},
    );
    await call(
      'reenviar antes de aprobar',
      400,
      'ti',
      'post',
      `${form}/resend-access-email`,
    );
    await call(
      'aprobar con rol inexistente',
      400,
      'ti',
      'post',
      `${form}/apply`,
      { roleId: branchA },
    );
    await call('aprobar', 201, 'ti', 'post', `${form}/apply`, {});
    expect(await emailSentOf(t1.id)).toBe(true);
    await call('usuario creado', 200, 'ti', 'get', `/tickets/${t1.id}`);
    await call('aprobar dos veces', 409, 'ti', 'post', `${form}/apply`, {});
    await call(
      'editar aprobado',
      409,
      'ana',
      'patch',
      form,
      access('X', 'x').form,
    );

    mail.sendAccessGrantedEmail.mockRejectedValueOnce(new Error('SMTP caído'));
    await call(
      'reenvío falla',
      503,
      'ti',
      'post',
      `${form}/resend-access-email`,
    );
    expect(await emailSentOf(t1.id)).toBe(false);
    await call(
      'reenvío sin users:create',
      403,
      'soporte',
      'post',
      `${form}/resend-access-email`,
    );
    await call('reenvío', 201, 'ti', 'post', `${form}/resend-access-email`);
    expect(await emailSentOf(t1.id)).toBe(true);

    const t2 = await call(
      'pedir el mismo correo',
      201,
      'beto',
      'post',
      '/tickets',
      access('Carla Otra', 'carla'),
    );
    labels.set(t2.id, '<ticket:acceso-2>');
    await call(
      'validar correo existente',
      409,
      'ti',
      'post',
      `/tickets/${t2.id}/form/validate`,
      {},
    );
    await call(
      'aprobar correo existente',
      409,
      'ti',
      'post',
      `/tickets/${t2.id}/form/apply`,
      {},
    );

    mail.sendAccessGrantedEmail.mockRejectedValueOnce(new Error('SMTP caído'));
    const t3 = await call(
      'otra solicitud',
      201,
      'ana',
      'post',
      '/tickets',
      access('Dario', 'dario'),
    );
    labels.set(t3.id, '<ticket:acceso-3>');
    await call(
      'aprobar con correo caído',
      201,
      'ti',
      'post',
      `/tickets/${t3.id}/form/apply`,
      {},
    );
    expect(await emailSentOf(t3.id)).toBe(false);
    await call(
      'detalle con correo fallido',
      200,
      'ti',
      'get',
      `/tickets/${t3.id}`,
    );
  });
});
