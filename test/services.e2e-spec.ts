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
 * Services (`/services`, public and admin) end to end against a real database:
 * price sheet rules, priced studies per sheet, slugs, benefits/details and
 * deletion. Creates its own branches, sheets, studies and users and deletes
 * them afterwards. With SERVICES_E2E_TRACE=<path> it writes every normalized
 * response to a file, to compare behavior before and after a refactor.
 */
describe('Servicios (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `e2e-${Date.now().toString(36)}`;
  const password = `E2e-${Math.random().toString(36).slice(2)}!`;
  const ids = {
    branchA: '',
    branchB: '',
    addressIds: [] as number[],
    userIds: [] as string[],
    sheets: {} as Record<
      'publicA' | 'privateA' | 'inactiveA' | 'publicB',
      string
    >,
    sectionId: 0,
    sampleTypeId: 0,
  };
  let token = '';
  let outsiderToken = '';

  const trace: unknown[] = [];
  const labels = new Map<string, string>();
  const unordered = new Set(['benefits', 'details', 'studies']);
  /**
   * Benefits, details and the studies nested in the public list have no
   * orderBy, so Postgres picks their order: the trace sorts them. Paginated
   * studies (`studies.data`, ordered by name) keep their order.
   */
  const canonical = (value: unknown, key = ''): unknown => {
    if (Array.isArray(value)) {
      const items = value.map((v) => canonical(v));
      return unordered.has(key)
        ? items.sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          )
        : items;
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, canonical(v, k)]),
      );
    }
    return value;
  };
  const normalize = (value: unknown) =>
    canonical(
      JSON.parse(
        JSON.stringify(value ?? null)
          .replace(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
            (id) => labels.get(id) ?? '<id>',
          )
          .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<date>')
          // Catálogos y direcciones usan ids autoincrementales.
          .replace(/"(id|sectionId|sampleTypeId|addressId)":\d+/g, '"$1":"<n>"')
          .split(tag)
          .join('<tag>')
          .split(tag.toUpperCase())
          .join('<TAG>'),
      ),
    );

  type Method = 'get' | 'post' | 'patch' | 'delete';
  const call = async (
    name: string,
    expected: number,
    method: Method,
    url: string,
    body?: object,
    asToken: string | null = token,
  ) => {
    let req = request(app.getHttpServer())[method](`/api${url}`);
    if (asToken) req = req.set('Authorization', `Bearer ${asToken}`);
    const res = await (body ? req.send(body) : req);
    trace.push({
      name,
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

  const service = (name: string, extra: object = {}) => ({
    name: `${name} ${tag}`,
    description: `Servicio ${name}`,
    imageUrl: 'https://example.com/s.png',
    branchId: ids.branchA,
    ...extra,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({})
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

    const sheet = async (
      key: keyof typeof ids.sheets,
      branchId: string,
      isPublic: boolean,
      isActive = true,
    ) => {
      const created = await prisma.priceSheets.create({
        data: {
          name: `Tarifario ${key} ${tag}`,
          description: key,
          branchId,
          isPublic,
          isActive,
        },
      });
      labels.set(created.id, `<sheet:${key}>`);
      ids.sheets[key] = created.id;
    };
    await sheet('publicA', ids.branchA, true);
    await sheet('privateA', ids.branchA, false);
    await sheet('inactiveA', ids.branchA, true, false);
    await sheet('publicB', ids.branchB, true);
    ids.sectionId = (
      await prisma.studySection.create({
        data: { name: `Sección ${tag}`, branchId: ids.branchA },
      })
    ).id;
    ids.sampleTypeId = (
      await prisma.sampleType.create({
        data: { name: `Suero ${tag}`, branchId: ids.branchA },
      })
    ).id;

    const hash = await bcrypt.hash(password, 10);
    const user = async (prefix: string, branches: string[]) => {
      const email = `${prefix}.${tag}@example.com`;
      const created = await prisma.user.create({
        data: {
          email,
          name: `${prefix} ${tag}`,
          password: hash,
          role: { connect: { name: 'Administrador' } },
          branches: { connect: branches.map((id) => ({ id })) },
        },
      });
      ids.userIds.push(created.id);
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
      return (res.body as { access_token: string }).access_token;
    };
    token = await user('admin', [ids.branchA]);
    outsiderToken = await user('ajeno', [ids.branchB]);
  }, 60_000);

  afterAll(async () => {
    if (process.env.SERVICES_E2E_TRACE) {
      writeFileSync(
        process.env.SERVICES_E2E_TRACE,
        JSON.stringify(trace, null, 2),
      );
    }
    if (!prisma) return;
    const where = { branchId: { in: [ids.branchA, ids.branchB] } };
    const studyIds = (
      await prisma.study.findMany({ where, select: { id: true } })
    ).map((s) => s.id);
    await prisma.studyPanelItem.deleteMany({
      where: {
        OR: [{ panelId: { in: studyIds } }, { childId: { in: studyIds } }],
      },
    });
    await prisma.studyOnPriceSheet.deleteMany({
      where: { studyId: { in: studyIds } },
    });
    await prisma.study.deleteMany({ where });
    await prisma.service.deleteMany({ where });
    await prisma.priceSheets.deleteMany({ where });
    await prisma.studySection.deleteMany({ where });
    await prisma.sampleType.deleteMany({ where });
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
    await prisma.branch.deleteMany({
      where: { id: { in: [ids.branchA, ids.branchB] } },
    });
    await prisma.address.deleteMany({ where: { id: { in: ids.addressIds } } });
    await app.close();
  }, 60_000);

  it('alta, consultas públicas y de admin, edición y baja', async () => {
    const { branchA, branchB, sheets } = ids;

    // Alta y reglas del tarifario asignado
    const lab = await call(
      'alta con tarifario',
      201,
      'post',
      '/services',
      service('Laboratorio', {
        priceSheetId: sheets.publicA,
        benefits: [
          { title: 'Rápido', description: 'En 24 h' },
          { title: 'Confiable' },
        ],
        details: [{ title: 'Toma de muestra', description: 'Sucursal' }],
      }),
    );
    labels.set(lab.id, '<service:lab>');
    await call(
      'nombre repetido',
      409,
      'post',
      '/services',
      service('Laboratorio'),
    );
    await call(
      'tarifario de otra sucursal',
      400,
      'post',
      '/services',
      service('X1', { priceSheetId: sheets.publicB }),
    );
    await call(
      'tarifario privado',
      400,
      'post',
      '/services',
      service('X2', { priceSheetId: sheets.privateA }),
    );
    await call(
      'tarifario inexistente',
      404,
      'post',
      '/services',
      service('X3', { priceSheetId: branchA }),
    );
    await call('sin imagen', 400, 'post', '/services', {
      name: `X4 ${tag}`,
      branchId: branchA,
    });
    await call('sin sesión', 401, 'post', '/services', service('X5'), null);
    const plain = await call(
      'alta sin tarifario',
      201,
      'post',
      '/services',
      service('Imagen'),
    );
    labels.set(plain.id, '<service:imagen>');
    const inactive = await call(
      'alta inactivo',
      201,
      'post',
      '/services',
      service('Archivado', { isActive: false }),
    );
    labels.set(inactive.id, '<service:archivado>');
    await call(
      'alta en sucursal B sin acceso',
      403,
      'post',
      '/services',
      service('Norte', { branchId: branchB, priceSheetId: sheets.publicB }),
    );
    const foreign = await call(
      'alta en sucursal B',
      201,
      'post',
      '/services',
      service('Norte', { branchId: branchB, priceSheetId: sheets.publicB }),
      outsiderToken,
    );
    labels.set(foreign.id, '<service:norte>');

    // Estudios del servicio (por la API de estudios, con sus precios)
    const study = async (
      code: string,
      extra: object,
      prices: Array<[string, number, boolean]>,
    ) => {
      const created = await call(`estudio ${code}`, 201, 'post', '/studies', {
        name: `Estudio ${code}`,
        code: `${code}-${tag}`,
        serviceId: lab.id,
        branchId: branchA,
        sectionId: ids.sectionId,
        sampleTypeId: ids.sampleTypeId,
        description: `Descripción ${code}`,
        preparation: 'Ayuno',
        deliveryTime: 2,
        studyPrices: prices.map(([priceSheetId, price, showPrice]) => ({
          priceSheetId,
          price,
          showPrice,
        })),
        ...extra,
      });
      labels.set(created.id, `<study:${code}>`);
      return created;
    };
    await study('GLU', {}, [
      [sheets.publicA, 100, true],
      [sheets.privateA, 80, true],
    ]);
    await study('COL', {}, [[sheets.publicA, 150, false]]);
    await study('PERF', { isPanel: true }, [[sheets.publicA, 300, true]]);
    await study('PARAM', {}, []);
    await study('PRIV', {}, [[sheets.privateA, 50, true]]);
    await study('OLD', { isActive: false }, [[sheets.publicA, 10, true]]);

    // Lista pública
    await call(
      'lista global (por búsqueda)',
      200,
      'get',
      `/services?search=${tag}`,
      undefined,
      null,
    );
    await call(
      'lista por sucursal',
      200,
      'get',
      `/services?branchId=${branchA}`,
      undefined,
      null,
    );
    await call(
      'lista con tarifario público',
      200,
      'get',
      `/services?branchId=${branchA}&priceSheetId=${sheets.publicA}`,
      undefined,
      null,
    );
    await call(
      'lista solo perfiles',
      200,
      'get',
      `/services?branchId=${branchA}&isPanel=true`,
      undefined,
      null,
    );
    await call(
      'lista sin perfiles',
      200,
      'get',
      `/services?branchId=${branchA}&isPanel=false&limit=1&page=2`,
      undefined,
      null,
    );
    await call(
      'lista tarifario privado',
      404,
      'get',
      `/services?branchId=${branchA}&priceSheetId=${sheets.privateA}`,
      undefined,
      null,
    );
    await call(
      'lista tarifario inactivo',
      404,
      'get',
      `/services?branchId=${branchA}&priceSheetId=${sheets.inactiveA}`,
      undefined,
      null,
    );
    await call(
      'lista tarifario de otra sucursal',
      404,
      'get',
      `/services?branchId=${branchA}&priceSheetId=${sheets.publicB}`,
      undefined,
      null,
    );

    // Detalle público
    await call(
      'detalle por id',
      200,
      'get',
      `/services/${lab.id}`,
      undefined,
      null,
    );
    await call(
      'detalle por slug y sucursal',
      200,
      'get',
      `/services/${lab.slug}?branchId=${branchA}`,
      undefined,
      null,
    );
    await call(
      'detalle con búsqueda',
      200,
      'get',
      `/services/${lab.id}?search=glu`,
      undefined,
      null,
    );
    await call(
      'detalle solo perfiles',
      200,
      'get',
      `/services/${lab.id}?isPanel=true`,
      undefined,
      null,
    );
    await call(
      'detalle paginado',
      200,
      'get',
      `/services/${lab.id}?limit=1&page=2`,
      undefined,
      null,
    );
    await call(
      'detalle sin tarifario',
      200,
      'get',
      `/services/${plain.id}`,
      undefined,
      null,
    );
    await call(
      'detalle en otra sucursal',
      404,
      'get',
      `/services/${lab.id}?branchId=${branchB}`,
      undefined,
      null,
    );
    await call(
      'detalle sucursal inexistente',
      404,
      'get',
      `/services/${lab.id}?branchId=${sheets.publicA}`,
      undefined,
      null,
    );
    await call(
      'detalle inexistente',
      404,
      'get',
      `/services/no-existe-${tag}`,
      undefined,
      null,
    );

    // Admin
    await call(
      'admin lista',
      200,
      'get',
      `/services/admin?branchId=${branchA}`,
    );
    await call(
      'admin lista inactivos',
      200,
      'get',
      `/services/admin?isActive=false`,
    );
    await call(
      'admin lista sucursal ajena',
      403,
      'get',
      `/services/admin?branchId=${branchA}`,
      undefined,
      outsiderToken,
    );
    await call('admin detalle', 200, 'get', `/services/admin/${lab.id}`);
    await call(
      'admin detalle activos',
      200,
      'get',
      `/services/admin/${lab.id}?isActive=true&search=e&limit=3`,
    );
    await call(
      'admin detalle inactivos',
      200,
      'get',
      `/services/admin/${lab.id}?isActive=false`,
    );
    await call(
      'admin detalle perfiles',
      200,
      'get',
      `/services/admin/${lab.id}?isPanel=true`,
    );
    await call(
      'admin detalle sin tarifario',
      200,
      'get',
      `/services/admin/${plain.id}`,
    );
    await call(
      'admin detalle ajeno',
      403,
      'get',
      `/services/admin/${lab.id}`,
      undefined,
      outsiderToken,
    );
    await call(
      'admin detalle inexistente',
      404,
      'get',
      `/services/admin/${branchA}`,
    );

    // Edición
    await call('renombrar', 200, 'patch', `/services/${plain.id}`, {
      name: `Imagenología ${tag}`,
      benefits: [{ title: 'Nuevo beneficio' }],
    });
    await call('quitar beneficios', 200, 'patch', `/services/${lab.id}`, {
      benefits: [],
      description: 'Actualizado',
    });
    await call('reemplazar detalles', 200, 'patch', `/services/${lab.id}`, {
      details: [{ title: 'Entrega en línea' }, { title: 'Factura' }],
    });
    await call('editar sin cambios', 200, 'patch', `/services/${lab.id}`, {});
    await call(
      'asignar tarifario privado',
      400,
      'patch',
      `/services/${plain.id}`,
      { priceSheetId: sheets.privateA },
    );
    await call(
      'asignar tarifario de B',
      400,
      'patch',
      `/services/${plain.id}`,
      { priceSheetId: sheets.publicB },
    );
    await call('editar inexistente', 404, 'patch', `/services/${branchA}`, {
      description: 'x',
    });
    await call(
      'nombre repetido al editar',
      409,
      'patch',
      `/services/${plain.id}`,
      { name: `Laboratorio ${tag}` },
    );
    await call('quitar tarifario', 200, 'patch', `/services/${lab.id}`, {
      priceSheetId: null,
    });
    await call(
      'detalle tras quitar tarifario',
      200,
      'get',
      `/services/${lab.id}`,
      undefined,
      null,
    );
    await call('reasignar tarifario', 200, 'patch', `/services/${lab.id}`, {
      priceSheetId: sheets.publicA,
    });
    await prisma.priceSheets.update({
      where: { id: sheets.publicA },
      data: { isActive: false },
    });
    await call(
      'detalle con tarifario inactivo',
      200,
      'get',
      `/services/${lab.id}`,
      undefined,
      null,
    );
    await call(
      'lista con tarifario inactivo',
      200,
      'get',
      `/services?branchId=${branchA}`,
      undefined,
      null,
    );

    // Escrituras acotadas a las sucursales del usuario
    await call(
      'alta en sucursal ajena',
      403,
      'post',
      '/services',
      service('X6'),
      outsiderToken,
    );
    await call(
      'editar de sucursal ajena',
      403,
      'patch',
      `/services/${lab.id}`,
      { description: 'hackeado' },
      outsiderToken,
    );
    await call(
      'mover a sucursal sin acceso',
      403,
      'patch',
      `/services/${plain.id}`,
      { branchId: branchB },
    );
    await call(
      'borrar de sucursal ajena',
      403,
      'delete',
      `/services/${inactive.id}`,
      undefined,
      outsiderToken,
    );
    await call(
      'editar inexistente sin acceso',
      404,
      'patch',
      `/services/${branchA}`,
      { description: 'x' },
      outsiderToken,
    );
    await call(
      'editar desde su sucursal',
      200,
      'patch',
      `/services/${foreign.id}`,
      { description: 'Norte actualizado' },
      outsiderToken,
    );
    await call(
      'detalle tras intentos ajenos',
      200,
      'get',
      `/services/admin/${lab.id}`,
    );

    // Baja
    await call('borrar con estudios', 409, 'delete', `/services/${lab.id}`);
    await call(
      'borrar sin estudios',
      200,
      'delete',
      `/services/${inactive.id}`,
    );
    await call('borrar inexistente', 404, 'delete', `/services/${inactive.id}`);
  });
});
