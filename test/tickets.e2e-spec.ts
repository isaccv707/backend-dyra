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
import { ensureE2eBaseData } from './support/e2e-seed';

/**
 * Ticket lifecycle (`POST/GET/PATCH /tickets`) end to end against a real
 * database: creation rules and quota, list filters and visibility, detail with
 * internal notes, status transitions and reclassification. Forms are covered
 * by tickets-forms.e2e-spec.ts. Creates its own branches, users and
 * subcategories and deletes them afterwards. With TICKETS_E2E_TRACE=<path> it
 * writes every normalized response to a file, to compare behavior before and
 * after a refactor.
 */
describe('Tickets: ciclo de vida (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `e2e-${Date.now().toString(36)}`;
  const password = `E2e-${Math.random().toString(36).slice(2)}!`;
  const ids = {
    branchA: '',
    branchB: '',
    addressIds: [] as number[],
    userIds: [] as string[],
    subcategoryIds: [] as string[],
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

  const ticket = (title: string, extra: object = {}) => ({
    branchId: ids.branchA,
    title: `${title} ${tag}`,
    description: `Descripción de ${title}`,
    category: 'HARDWARE',
    ...extra,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ sendAccessGrantedEmail: jest.fn() })
      .overrideProvider(MailQueueService)
      .useValue({ enqueue: jest.fn() })
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
    await user('ti2', 'Administrador', [ids.branchA]);
    await user('ana', 'Usuario', [ids.branchA]);
    await user('beto', 'Usuario', [ids.branchA]);
    await user('ajeno', 'Administrador', [ids.branchB]);

    const subcategory = async (key: string, category: 'HARDWARE' | 'OTHER') => {
      const created = await prisma.ticketSubcategory.create({
        data: { category, name: `${key} ${tag}` },
      });
      ids.subcategoryIds.push(created.id);
      labels.set(created.id, `<subcategory:${key}>`);
      return created.id;
    };
    await subcategory('impresoras', 'HARDWARE');
    await subcategory('pantallas', 'HARDWARE');
    await subcategory('varios', 'OTHER');
  }, 60_000);

  afterAll(async () => {
    if (process.env.TICKETS_E2E_TRACE) {
      writeFileSync(
        process.env.TICKETS_E2E_TRACE,
        JSON.stringify(trace, null, 2),
      );
    }
    if (!prisma) return;
    const branchIds = [ids.branchA, ids.branchB];
    await prisma.ticket.deleteMany({ where: { branchId: { in: branchIds } } });
    await prisma.ticketCounter.deleteMany({
      where: { branchId: { in: branchIds } },
    });
    await prisma.ticketSubcategory.deleteMany({
      where: { id: { in: ids.subcategoryIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    await prisma.address.deleteMany({ where: { id: { in: ids.addressIds } } });
    await app.close();
  }, 60_000);

  const sub = (key: string) =>
    [...labels].find(([, label]) => label === `<subcategory:${key}>`)![0];

  it('crea, lista, consulta y actualiza tickets', async () => {
    const { branchA, branchB } = ids;

    // Alta: reglas de categoría, subcategoría y formulario
    await call(
      'sin descripción',
      400,
      'ana',
      'post',
      '/tickets',
      ticket('X1', { description: undefined }),
    );
    await call(
      'sin título',
      400,
      'ana',
      'post',
      '/tickets',
      ticket('X2', { title: undefined }),
    );
    await call(
      'formulario sobrante',
      400,
      'ana',
      'post',
      '/tickets',
      ticket('X3', { form: { a: 1 } }),
    );
    await call(
      'software sin formulario',
      400,
      'ana',
      'post',
      '/tickets',
      ticket('X4', { category: 'SOFTWARE' }),
    );
    await call(
      'cogniti sin subcategoría',
      400,
      'ana',
      'post',
      '/tickets',
      ticket('X5', { category: 'COGNITI' }),
    );
    await call(
      'subcategoría de otra categoría',
      400,
      'ana',
      'post',
      '/tickets',
      ticket('X6', { subcategoryId: sub('varios') }),
    );
    await call(
      'subcategoría inexistente',
      404,
      'ana',
      'post',
      '/tickets',
      ticket('X7', { subcategoryId: branchA }),
    );
    await call(
      'sucursal ajena',
      403,
      'ana',
      'post',
      '/tickets',
      ticket('X8', { branchId: branchB }),
    );

    const t1 = await call(
      'alta impresora',
      201,
      'ana',
      'post',
      '/tickets',
      ticket('Impresora', {
        subcategoryId: sub('impresoras'),
        priority: 'HIGH',
      }),
    );
    labels.set(t1.id, '<ticket:1>');
    const t2 = await call(
      'alta otro',
      201,
      'beto',
      'post',
      '/tickets',
      ticket('Silla', { category: 'OTHER', priority: 'LOW' }),
    );
    labels.set(t2.id, '<ticket:2>');
    const t3 = await call(
      'alta de TI',
      201,
      'ti',
      'post',
      '/tickets',
      ticket('Monitor', { subcategoryId: sub('pantallas') }),
    );
    labels.set(t3.id, '<ticket:3>');

    // Cuota por usuario: 10 tickets por minuto
    const now = Date.now();
    for (let i = 0; i < 9; i++) {
      await prisma.ticket.create({
        data: {
          code: 100 + i,
          title: `Cuota ${i} ${tag}`,
          category: 'OTHER',
          branchId: branchB,
          createdById: users.ajeno.id,
          createdAt: new Date(now - (i + 1) * 1000),
        },
      });
    }
    await call(
      'décimo ticket del minuto',
      201,
      'ajeno',
      'post',
      '/tickets',
      ticket('Cuota 10', { branchId: branchB, category: 'OTHER' }),
    );
    await call(
      'cuota excedida',
      429,
      'ajeno',
      'post',
      '/tickets',
      ticket('Cuota 11', { branchId: branchB, category: 'OTHER' }),
    );

    // Asignados y comentarios internos
    await prisma.ticketAssignee.create({
      data: { ticketId: t1.id, userId: users.ti2.id },
    });
    await prisma.ticketAssignee.create({
      data: { ticketId: t2.id, userId: users.ana.id },
    });
    await prisma.ticketComment.create({
      data: {
        ticketId: t1.id,
        authorId: users.ti.id,
        body: 'nota interna',
        isInternal: true,
      },
    });
    await prisma.ticketComment.create({
      data: { ticketId: t1.id, authorId: users.ana.id, body: 'sigue fallando' },
    });

    // Lista
    const byCode = 'sort[field]=code&sort[order]=asc';
    await call(
      'TI: sucursal',
      200,
      'ti',
      'get',
      `/tickets?branchId=${branchA}&${byCode}`,
    );
    await call(
      'TI: todas sus sucursales',
      200,
      'ti',
      'get',
      `/tickets?${byCode}`,
    );
    await call(
      'TI: por estado y prioridad',
      200,
      'ti',
      'get',
      `/tickets?status=OPEN&priority=HIGH&${byCode}`,
    );
    await call(
      'TI: por categoría y subcategoría',
      200,
      'ti',
      'get',
      `/tickets?category=HARDWARE&subcategoryId=${sub('pantallas')}`,
    );
    await call(
      'TI: búsqueda por folio',
      200,
      'ti',
      'get',
      `/tickets?search=%232&branchId=${branchA}`,
    );
    await call(
      'TI: búsqueda por texto',
      200,
      'ti',
      'get',
      `/tickets?search=impresora&${byCode}`,
    );
    await call(
      'TI: por asignado',
      200,
      'ti',
      'get',
      `/tickets?assigneeId=${users.ti2.id}`,
    );
    await call(
      'TI: mis tickets',
      200,
      'ti',
      'get',
      `/tickets?mine=true&${byCode}`,
    );
    await call(
      'TI2: asignados a mí',
      200,
      'ti2',
      'get',
      `/tickets?assignedToMe=true`,
    );
    await call(
      'TI: sin formulario pendiente',
      200,
      'ti',
      'get',
      `/tickets?formStatus=PENDING&branchId=${branchA}`,
    );
    await call(
      'ana: solo los suyos y asignados',
      200,
      'ana',
      'get',
      `/tickets?${byCode}`,
    );
    await call(
      'ana: por sucursal',
      200,
      'ana',
      'get',
      `/tickets?branchId=${branchA}&${byCode}`,
    );
    await call(
      'beto: solo los suyos',
      200,
      'beto',
      'get',
      `/tickets?${byCode}`,
    );
    await call(
      'ajeno: sucursal sin acceso',
      403,
      'ajeno',
      'get',
      `/tickets?branchId=${branchA}`,
    );

    // Detalle
    await call(
      'TI: detalle con nota interna',
      200,
      'ti',
      'get',
      `/tickets/${t1.id}`,
    );
    await call(
      'ana: detalle sin nota interna',
      200,
      'ana',
      'get',
      `/tickets/${t1.id}`,
    );
    await call(
      'ana: asignada en ticket ajeno',
      200,
      'ana',
      'get',
      `/tickets/${t2.id}`,
    );
    await call('beto: ticket de otro', 403, 'beto', 'get', `/tickets/${t1.id}`);
    await call(
      'ajeno: otra sucursal',
      403,
      'ajeno',
      'get',
      `/tickets/${t1.id}`,
    );
    await call('inexistente', 404, 'ti', 'get', `/tickets/${branchA}`);

    // Cambios de estado
    await call('sin permiso', 403, 'ana', 'patch', `/tickets/${t1.id}`, {
      status: 'IN_PROGRESS',
    });
    await call('ajeno', 403, 'ajeno', 'patch', `/tickets/${t1.id}`, {
      status: 'IN_PROGRESS',
    });
    await call(
      'editar inexistente',
      404,
      'ti',
      'patch',
      `/tickets/${branchA}`,
      { status: 'IN_PROGRESS' },
    );
    await call('abierto a cerrado', 400, 'ti', 'patch', `/tickets/${t1.id}`, {
      status: 'CLOSED',
    });
    await call('en progreso', 200, 'ti', 'patch', `/tickets/${t1.id}`, {
      status: 'IN_PROGRESS',
      priority: 'CRITICAL',
    });
    await call('en espera', 200, 'ti', 'patch', `/tickets/${t1.id}`, {
      status: 'ON_HOLD',
    });
    await call('espera a resuelto', 400, 'ti', 'patch', `/tickets/${t1.id}`, {
      status: 'RESOLVED',
    });
    await call('reanudar', 200, 'ti', 'patch', `/tickets/${t1.id}`, {
      status: 'IN_PROGRESS',
    });
    await call('resolver', 200, 'ti', 'patch', `/tickets/${t1.id}`, {
      status: 'RESOLVED',
    });
    await call('reabrir', 200, 'ti', 'patch', `/tickets/${t1.id}`, {
      status: 'IN_PROGRESS',
    });
    await call('mismo estado', 200, 'ti', 'patch', `/tickets/${t1.id}`, {
      status: 'IN_PROGRESS',
    });
    await call('resolver otra vez', 200, 'ti', 'patch', `/tickets/${t1.id}`, {
      status: 'RESOLVED',
    });
    await call('cerrar', 200, 'ti', 'patch', `/tickets/${t1.id}`, {
      status: 'CLOSED',
    });
    await call('cancelar', 200, 'ti', 'patch', `/tickets/${t2.id}`, {
      status: 'CANCELLED',
    });
    await call('reabrir cancelado', 400, 'ti', 'patch', `/tickets/${t2.id}`, {
      status: 'IN_PROGRESS',
    });

    // Reclasificación
    await call(
      'cambiar subcategoría',
      200,
      'ti',
      'patch',
      `/tickets/${t3.id}`,
      { subcategoryId: sub('impresoras') },
    );
    await call(
      'subcategoría ajena a la categoría',
      400,
      'ti',
      'patch',
      `/tickets/${t3.id}`,
      { subcategoryId: sub('varios') },
    );
    await call(
      'categoría y subcategoría',
      200,
      'ti',
      'patch',
      `/tickets/${t3.id}`,
      { category: 'OTHER', subcategoryId: sub('varios') },
    );
    await call(
      'categoría sin quitar subcategoría',
      400,
      'ti',
      'patch',
      `/tickets/${t3.id}`,
      { category: 'HARDWARE' },
    );
    await call('quitar subcategoría', 200, 'ti', 'patch', `/tickets/${t3.id}`, {
      subcategoryId: null,
    });
    await call(
      'a categoría con formulario',
      400,
      'ti',
      'patch',
      `/tickets/${t3.id}`,
      { category: 'SOFTWARE' },
    );
    await call(
      'a cogniti sin subcategoría',
      400,
      'ti',
      'patch',
      `/tickets/${t3.id}`,
      { category: 'COGNITI' },
    );
    await call('regresar a hardware', 200, 'ti', 'patch', `/tickets/${t3.id}`, {
      category: 'HARDWARE',
      priority: 'LOW',
    });

    // Historial de cambios resultante
    await call('detalle final t1', 200, 'ti', 'get', `/tickets/${t1.id}`);
    await call('detalle final t3', 200, 'ti', 'get', `/tickets/${t3.id}`);
    await call(
      'lista final',
      200,
      'ti',
      'get',
      `/tickets?branchId=${branchA}&${byCode}`,
    );
  });
});
