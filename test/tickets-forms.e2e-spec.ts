import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { seedRolesAndPermissions } from 'prisma/seeds/roles-permissions.seed';
import { seedStates } from 'prisma/seeds/states.seed';
import { seedTicketSubcategories } from 'prisma/seeds/ticket-subcategories.seed';

/**
 * Ticket forms end to end against a real database: request → validate →
 * approve / reject, with the real transaction, permissions and folios.
 * Creates its own branch and users and deletes them afterwards.
 */
describe('Formularios de tickets (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `e2e-${Date.now().toString(36)}`;
  const password = `E2e-${Math.random().toString(36).slice(2)}!`;
  const mail = {
    sendAccessGrantedEmail: jest.fn().mockResolvedValue(undefined),
    sendTicketAssignedEmail: jest.fn().mockResolvedValue(undefined),
    sendOtpEmail: jest.fn().mockResolvedValue(undefined),
  };

  const ids = {
    branchId: '',
    addressId: 0,
    serviceId: '',
    sectionId: 0,
    sampleTypeId: 0,
    priceSheetId: '',
    userIds: [] as string[],
  };
  let adminToken = '';
  let requesterToken = '';
  let subcategories: Record<string, string> = {};

  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  const login = async (email: string) => {
    const res = await api()
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.access_token as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    const db = prisma as unknown as PrismaClient;

    if (!(await prisma.role.findUnique({ where: { name: 'Administrador' } }))) {
      await seedRolesAndPermissions(db);
    }
    await seedStates(db);
    await seedTicketSubcategories(db);

    const state = await prisma.state.findFirstOrThrow();
    const address = await prisma.address.create({
      data: { street: 'E2E', extNumber: '1', zipCode: '00000', city: 'E2E' },
    });
    const branch = await prisma.branch.create({
      data: {
        name: `Sucursal ${tag}`,
        urlResults: 'https://example.com',
        stateId: state.id,
        addressId: address.id,
      },
    });
    ids.branchId = branch.id;
    ids.addressId = address.id;
    ids.serviceId = (
      await prisma.service.create({
        data: {
          name: `Servicio ${tag}`,
          slug: `servicio-${tag}`,
          imageUrl: 'https://example.com/x.png',
          branchId: branch.id,
        },
      })
    ).id;
    ids.sectionId = (
      await prisma.studySection.create({
        data: { name: `Sección ${tag}`, branchId: branch.id },
      })
    ).id;
    ids.sampleTypeId = (
      await prisma.sampleType.create({
        data: { name: `Muestra ${tag}`, branchId: branch.id },
      })
    ).id;
    ids.priceSheetId = (
      await prisma.priceSheets.create({
        data: {
          name: `Tarifario ${tag}`,
          description: 'e2e',
          branchId: branch.id,
        },
      })
    ).id;

    const hash = await bcrypt.hash(password, 10);
    for (const [role, email] of [
      ['Administrador', `admin.${tag}@example.com`],
      ['Usuario', `user.${tag}@example.com`],
    ]) {
      const user = await prisma.user.create({
        data: {
          email,
          name: `${role} ${tag}`,
          password: hash,
          role: { connect: { name: role } },
          branches: { connect: { id: branch.id } },
        },
      });
      ids.userIds.push(user.id);
    }
    adminToken = await login(`admin.${tag}@example.com`);
    requesterToken = await login(`user.${tag}@example.com`);

    const subs = await prisma.ticketSubcategory.findMany({
      where: { category: 'COGNITI', formType: { not: null } },
    });
    subcategories = Object.fromEntries(subs.map((s) => [s.formType, s.id]));
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    const { branchId } = ids;
    if (branchId) {
      const studies = await prisma.study.findMany({
        where: { branchId },
        select: { id: true },
      });
      const studyIds = studies.map((s) => s.id);
      await prisma.ticket.deleteMany({ where: { branchId } });
      await prisma.ticketCounter.deleteMany({ where: { branchId } });
      await prisma.studyPanelItem.deleteMany({
        where: {
          OR: [{ panelId: { in: studyIds } }, { childId: { in: studyIds } }],
        },
      });
      await prisma.studyOnPriceSheet.deleteMany({
        where: { studyId: { in: studyIds } },
      });
      await prisma.referenceValue.deleteMany({
        where: { studyId: { in: studyIds } },
      });
      await prisma.study.deleteMany({ where: { branchId } });
      await prisma.priceSheets.deleteMany({ where: { branchId } });
      await prisma.studySection.deleteMany({ where: { branchId } });
      await prisma.sampleType.deleteMany({ where: { branchId } });
      await prisma.service.deleteMany({ where: { branchId } });
    }
    const createdUsers = await prisma.user.findMany({
      where: {
        OR: [
          { id: { in: ids.userIds } },
          { email: { endsWith: `.${tag}@example.com` } },
        ],
      },
      select: { id: true },
    });
    await prisma.user.deleteMany({
      where: { id: { in: createdUsers.map((u) => u.id) } },
    });
    if (branchId) await prisma.branch.delete({ where: { id: branchId } });
    if (ids.addressId) {
      await prisma.address.delete({ where: { id: ids.addressId } });
    }
    await app.close();
  }, 60_000);

  const studyRequest = () => ({
    branchId: ids.branchId,
    category: 'COGNITI',
    subcategoryId: subcategories.STUDY_CREATE,
    form: {
      name: `Perfil ${tag}`,
      serviceId: ids.serviceId,
      sectionId: ids.sectionId,
      sampleTypeId: ids.sampleTypeId,
      isPanel: true,
      studyPrices: [{ priceSheetId: ids.priceSheetId, price: 250 }],
      panelItems: [
        {
          newStudy: {
            name: `Urea ${tag}`,
            serviceId: ids.serviceId,
            sectionId: ids.sectionId,
            sampleTypeId: ids.sampleTypeId,
            units: 'mg/dL',
            referenceValues: [{ minValue: 15, maxValue: 45 }],
          },
        },
      ],
    },
  });

  it('crea solicitudes con folio consecutivo por sucursal', async () => {
    const first = await api()
      .post('/api/tickets')
      .set(as(requesterToken))
      .send(studyRequest())
      .expect(201);
    const second = await api()
      .post('/api/tickets')
      .set(as(requesterToken))
      .send({
        branchId: ids.branchId,
        category: 'HARDWARE',
        title: 'Monitor',
        description: 'No enciende',
      })
      .expect(201);

    expect(first.body.code).toBe(1);
    expect(second.body.code).toBe(2);
    expect(first.body.title).toBe(`Alta de perfil: Perfil ${tag}`);
    expect(first.body.form).toMatchObject({
      type: 'STUDY_CREATE',
      schemaVersion: 1,
      appliedAt: null,
    });
  });

  it('el solicitante no puede aprobar (403)', async () => {
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { branchId: ids.branchId, code: 1 },
    });
    await api()
      .post(`/api/tickets/${ticket.id}/form/apply`)
      .set(as(requesterToken))
      .send({ code: `P${tag}` })
      .expect(403);
  });

  it('validar sin aplicar no crea nada; aprobar crea el perfil y su hijo', async () => {
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { branchId: ids.branchId, code: 1 },
    });
    const identity = {
      code: `P${tag}`.slice(0, 20),
      newStudies: [{ code: `U${tag}`.slice(0, 20) }],
    };

    const validation = await api()
      .post(`/api/tickets/${ticket.id}/form/validate`)
      .set(as(adminToken))
      .send(identity)
      .expect(201);
    expect(validation.body.valid).toBe(true);
    expect(
      await prisma.study.count({ where: { branchId: ids.branchId } }),
    ).toBe(0);

    const applied = await api()
      .post(`/api/tickets/${ticket.id}/form/apply`)
      .set(as(adminToken))
      .send(identity)
      .expect(201);
    expect(applied.body.status).toBe('RESOLVED');

    const panel = await prisma.study.findFirstOrThrow({
      where: { branchId: ids.branchId, isPanel: true },
      include: { panelItems: true, priceSheets: true },
    });
    expect(panel.code).toBe(identity.code.toUpperCase());
    expect(panel.panelItems).toHaveLength(1);
    expect(panel.priceSheets).toHaveLength(1);

    await api()
      .post(`/api/tickets/${ticket.id}/form/apply`)
      .set(as(adminToken))
      .send(identity)
      .expect(409);
  });

  it('rechazar con motivo cancela el ticket y bloquea la aprobación', async () => {
    const created = await api()
      .post('/api/tickets')
      .set(as(requesterToken))
      .send({
        branchId: ids.branchId,
        category: 'ACCESS',
        form: {
          fullName: 'Ana E2E',
          email: `ana.${tag}@example.com`,
          roleId: (
            await prisma.role.findUniqueOrThrow({ where: { name: 'Usuario' } })
          ).id,
          branchId: ids.branchId,
        },
      })
      .expect(201);

    const rejected = await api()
      .post(`/api/tickets/${created.body.id}/form/reject`)
      .set(as(adminToken))
      .send({ reason: 'Falta autorización del gerente' })
      .expect(201);
    expect(rejected.body.status).toBe('CANCELLED');
    expect(rejected.body.form.rejectionReason).toBe(
      'Falta autorización del gerente',
    );

    await api()
      .post(`/api/tickets/${created.body.id}/form/apply`)
      .set(as(adminToken))
      .send({})
      .expect(409);
  });

  it('las notificaciones no leídas se filtran y se pueden purgar', async () => {
    const unread = await api()
      .get('/api/tickets/notifications?read=false')
      .set(as(requesterToken))
      .expect(200);
    expect(unread.body.total).toBeGreaterThan(0);
    expect(unread.body.data.every((n: { read: boolean }) => !n.read)).toBe(
      true,
    );
    expect(unread.body.data[0]).toMatchObject({
      kind: expect.any(String),
      ticket: { code: expect.any(Number), title: expect.any(String) },
    });

    await api()
      .patch('/api/tickets/notifications/read-all')
      .set(as(requesterToken))
      .expect(200);
    const after = await api()
      .get('/api/tickets/notifications?read=false')
      .set(as(requesterToken))
      .expect(200);
    expect(after.body.total).toBe(0);

    const purge = await api()
      .delete('/api/tickets/notifications')
      .set(as(requesterToken))
      .expect(200);
    expect(purge.body.deleted).toBeGreaterThan(0);
  });
});
