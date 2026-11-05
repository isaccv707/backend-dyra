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
 * Quotations end to end against a real database: the public PDF route of the
 * website (`POST /quotations/pdf`, public sheets only) and the admin routes
 * (any active sheet, list, detail, PDF, delete), with prices from the sheet,
 * custom items, panel snapshots and totals. Creates its own branches, sheets,
 * studies and users and deletes them afterwards. With
 * QUOTATIONS_E2E_TRACE=<path> it writes every normalized response (and the
 * quotation saved by the public route) to a file, to compare behavior before
 * and after a refactor.
 */
describe('Cotizaciones (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `e2e-${Date.now().toString(36)}`;
  const password = `E2e-${Math.random().toString(36).slice(2)}!`;
  const ids = {
    branchA: '',
    branchB: '',
    addressIds: [] as number[],
    userIds: [] as string[],
    sheets: {} as Record<string, string>,
    studies: {} as Record<string, string>,
  };
  let token = '';
  let outsiderToken = '';

  const trace: unknown[] = [];
  const labels = new Map<string, string>();
  /** Quotation items have no orderBy: the trace sorts them by name. */
  const sortItems = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortItems);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === 'items' && Array.isArray(v)
          ? [...(v as { name: string }[])].sort((a, b) =>
              a.name.localeCompare(b.name),
            )
          : sortItems(v),
      ]),
    );
  };
  const normalize = (value: unknown) =>
    sortItems(
      JSON.parse(
        JSON.stringify(value ?? null)
          .replace(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
            (id) => labels.get(id) ?? '<id>',
          )
          .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<date>')
          // Folio: DYRA-<today>-<random>.
          .replace(/DYRA-\d{8}-\d{6}/g, 'DYRA-<folio>')
          .replace(/"(id|addressId)":\d+/g, '"$1":"<n>"')
          .split(tag)
          .join('<tag>')
          .split(tag.toUpperCase())
          .join('<TAG>'),
      ),
    );

  type Method = 'get' | 'post' | 'put' | 'delete';
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

  const binary = (
    req: request.Test,
  ): Promise<{ status: number; type: string; isPdf: boolean; body: unknown }> =>
    req
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .then((res) => {
        const body = res.body as Buffer;
        const isPdf = body.subarray(0, 5).toString() === '%PDF-';
        return {
          status: res.status,
          type: String(res.headers['content-type']),
          isPdf,
          body: isPdf ? null : JSON.parse(body.toString() || 'null'),
        };
      });

  /** Public route: the response is the PDF; the saved quotation is traced. */
  const publicPdf = async (name: string, expected: number, body: object) => {
    const res = await binary(
      request(app.getHttpServer()).post('/api/quotations/pdf').send(body),
    );
    const phoneNumber = (body as { phoneNumber: string }).phoneNumber;
    const saved =
      res.status === 201
        ? await prisma.quotation.findFirst({
            where: { phoneNumber },
            include: { items: true },
          })
        : null;
    trace.push({
      name,
      status: res.status,
      contentType: res.type,
      isPdf: res.isPdf,
      error: normalize(res.body),
      saved: normalize(saved),
    });
    expect({ name, status: res.status }).toEqual({ name, status: expected });
  };

  const quote = (
    phone: string,
    studies: object[],
    extra: object = {},
  ): Record<string, unknown> => ({
    clientType: 'PARTICULAR',
    name: 'Laura',
    lastName: 'Gómez',
    phoneNumber: `55${phone}`,
    email: 'laura@example.com',
    branchId: ids.branchA,
    priceSheetId: ids.sheets.publico,
    studies,
    ...extra,
  });
  const item = (key: string, quantity = 1) => ({
    id: ids.studies[key],
    name: `ignorado ${key}`,
    price: 1,
    quantity,
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
    const branch = async (name: string, intNumber: string | null) => {
      const address = await prisma.address.create({
        data: {
          street: 'Av. Juárez',
          extNumber: '10',
          intNumber,
          neighborhood: 'Centro',
          zipCode: '00000',
          city: 'Puebla',
        },
      });
      ids.addressIds.push(address.id);
      const created = await prisma.branch.create({
        data: {
          name: `${name} ${tag}`,
          phone: '2221234567',
          email: 'sucursal@example.com',
          urlResults: 'https://example.com',
          stateId: state.id,
          addressId: address.id,
        },
      });
      labels.set(created.id, `<branch:${name}>`);
      return created.id;
    };
    ids.branchA = await branch('A', '3');
    ids.branchB = await branch('B', null);

    const sheet = async (
      key: string,
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
      ids.sheets[key] = created.id;
      labels.set(created.id, `<sheet:${key}>`);
    };
    await sheet('publico', ids.branchA, true);
    await sheet('privado', ids.branchA, false);
    await sheet('inactivo', ids.branchA, true, false);
    await sheet('norte', ids.branchB, true);

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

    // Studies with prices, through the studies API.
    const serviceId = (
      await prisma.service.create({
        data: {
          name: `Laboratorio ${tag}`,
          slug: `laboratorio-${tag}`,
          imageUrl: 'https://example.com/s.png',
          branchId: ids.branchA,
        },
      })
    ).id;
    const sectionId = (
      await prisma.studySection.create({
        data: { name: `Sección ${tag}`, branchId: ids.branchA },
      })
    ).id;
    const sampleTypeId = (
      await prisma.sampleType.create({
        data: { name: `Suero ${tag}`, branchId: ids.branchA },
      })
    ).id;
    const study = async (
      key: string,
      prices: Array<[string, number]>,
      extra: object = {},
    ) => {
      const res = await request(app.getHttpServer())
        .post('/api/studies')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `Estudio ${key}`,
          code: `${key}-${tag}`,
          serviceId,
          branchId: ids.branchA,
          sectionId,
          sampleTypeId,
          ...(prices.length && {
            studyPrices: prices.map(([sheetKey, price]) => ({
              priceSheetId: ids.sheets[sheetKey],
              price,
            })),
          }),
          ...extra,
        });
      if (res.status !== 201) {
        throw new Error(
          `estudio ${key}: ${res.status} ${JSON.stringify(res.body)}`,
        );
      }
      const id = (res.body as { id: string }).id;
      ids.studies[key] = id;
      labels.set(id, `<study:${key}>`);
    };
    await study('GLU', [
      ['publico', 120.5],
      ['privado', 90],
    ]);
    await study('COL', [['publico', 200]]);
    await study('TRI', [['publico', 180]]);
    await study('PRIV', [['privado', 75]]);
    await study('NOPRE', []);
    await study('PERFIL', [['publico', 450]], { isPanel: true });
    await study('SUBPER', [], { isPanel: true });
    await request(app.getHttpServer())
      .put(`/api/studies/${ids.studies.SUBPER}/panel-items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ childId: ids.studies.TRI }] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/studies/${ids.studies.PERFIL}/panel-items`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          { childId: ids.studies.GLU },
          { childId: ids.studies.SUBPER },
          { childId: ids.studies.COL },
        ],
      })
      .expect(200);
    await study('BAJA', [['publico', 99]]);
    await request(app.getHttpServer())
      .delete(`/api/studies/${ids.studies.BAJA}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  }, 90_000);

  afterAll(async () => {
    if (process.env.QUOTATIONS_E2E_TRACE) {
      writeFileSync(
        process.env.QUOTATIONS_E2E_TRACE,
        JSON.stringify(trace, null, 2),
      );
    }
    if (!prisma) return;
    const where = { branchId: { in: [ids.branchA, ids.branchB] } };
    await prisma.quotation.deleteMany({ where });
    const studyIds = Object.values(ids.studies);
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

  it('ruta pública del sitio: PDF solo con tarifarios públicos', async () => {
    const { sheets, branchA, branchB } = ids;
    await publicPdf(
      'estudios, perfil y concepto libre',
      201,
      quote('0001', [
        item('GLU', 2),
        item('PERFIL'),
        { name: 'Toma a domicilio', price: 150, quantity: 1 },
      ]),
    );
    await publicPdf(
      'solo conceptos libres',
      201,
      quote('0002', [{ name: 'Envío', price: 35.5, quantity: 3 }]),
    );
    await publicPdf(
      'tarifario privado',
      400,
      quote('0003', [item('GLU')], { priceSheetId: sheets.privado }),
    );
    await publicPdf(
      'tarifario inactivo',
      400,
      quote('0004', [item('GLU')], { priceSheetId: sheets.inactivo }),
    );
    await publicPdf(
      'tarifario de otra sucursal',
      400,
      quote('0005', [item('GLU')], { priceSheetId: sheets.norte }),
    );
    await publicPdf(
      'sucursal inexistente',
      404,
      quote('0006', [item('GLU')], { branchId: sheets.publico }),
    );
    await publicPdf('estudio sin precio', 404, quote('0007', [item('NOPRE')]));
    await publicPdf(
      'estudio de otro tarifario',
      404,
      quote('0008', [item('PRIV')]),
    );
    await publicPdf('estudio desactivado', 400, quote('0009', [item('BAJA')]));
    await publicPdf('cantidad inválida', 400, quote('0010', [item('GLU', 0)]));
    await publicPdf(
      'sin cliente',
      400,
      quote('0011', [item('GLU')], { name: '' }),
    );
    await publicPdf(
      'otra sucursal pública',
      201,
      quote('0012', [{ name: 'Consulta', price: 300, quantity: 1 }], {
        branchId: branchB,
        priceSheetId: sheets.norte,
      }),
    );
    void branchA;
  });

  it('rutas de admin: crear, listar, consultar, PDF y borrar', async () => {
    const { sheets, branchA } = ids;
    const admin = await call(
      'admin con tarifario privado',
      201,
      'post',
      '/quotations',
      quote('1001', [item('GLU'), item('PRIV', 3)], {
        priceSheetId: sheets.privado,
        clientType: 'empresa',
      }),
    );
    labels.set(admin.id, '<quotation:admin>');
    const second = await call(
      'admin con tarifario público',
      201,
      'post',
      '/quotations',
      quote('1002', [item('COL'), item('PERFIL')], {
        name: 'Mario',
        lastName: undefined,
        email: undefined,
      }),
    );
    labels.set(second.id, '<quotation:segunda>');
    await call(
      'admin tarifario inactivo',
      400,
      'post',
      '/quotations',
      quote('1003', [item('GLU')], { priceSheetId: sheets.inactivo }),
    );
    await call(
      'admin sucursal ajena',
      403,
      'post',
      '/quotations',
      quote('1004', [item('GLU')]),
      outsiderToken,
    );
    await call(
      'admin sin sesión',
      401,
      'post',
      '/quotations',
      quote('1005', [item('GLU')]),
      null,
    );

    await call(
      'lista de la sucursal',
      200,
      'get',
      `/quotations?branchId=${branchA}&sort[field]=phoneNumber&sort[order]=asc`,
    );
    await call('búsqueda por nombre', 200, 'get', `/quotations?search=Mario`);
    await call(
      'lista sucursal ajena',
      403,
      'get',
      `/quotations?branchId=${branchA}`,
      undefined,
      outsiderToken,
    );
    await call('detalle', 200, 'get', `/quotations/${admin.id}`);
    await call(
      'detalle ajeno',
      403,
      'get',
      `/quotations/${admin.id}`,
      undefined,
      outsiderToken,
    );
    await call('detalle inexistente', 404, 'get', `/quotations/${branchA}`);

    const pdf = await binary(
      request(app.getHttpServer())
        .get(`/api/quotations/${second.id}/pdf`)
        .set('Authorization', `Bearer ${token}`),
    );
    trace.push({
      name: 'pdf de admin',
      status: pdf.status,
      contentType: pdf.type,
      isPdf: pdf.isPdf,
    });
    expect(pdf.status).toBe(200);

    await call(
      'borrar ajeno',
      403,
      'delete',
      `/quotations/${admin.id}`,
      undefined,
      outsiderToken,
    );
    await call('borrar', 200, 'delete', `/quotations/${admin.id}`);
    await call('borrar dos veces', 404, 'delete', `/quotations/${admin.id}`);
  });
});
