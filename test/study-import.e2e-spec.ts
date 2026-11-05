import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { writeFileSync } from 'fs';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { MailService } from 'src/mail/mail.service';
import { MailQueueService } from 'src/mail/mail-queue.service';
import { PrismaService } from 'prisma/prisma/prisma.service';

type Row = Record<string, string | number>;

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const toExcel = (rows: Row[]): Buffer => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'H');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

/**
 * Excel import of studies (`POST /studies/import`) end to end against a real
 * database: creates, updates, catalogs, slugs and panels. Creates its own
 * branch and users and deletes them afterwards. With
 * STUDY_IMPORT_E2E_TRACE=<path> it writes every normalized response and the
 * resulting studies to a file, to compare behavior before and after a refactor.
 */
describe('Importación de estudios desde Excel (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `e2e-${Date.now().toString(36)}`;
  const password = `E2e-${Math.random().toString(36).slice(2)}!`;
  const service = `Química ${tag}`;
  const ids = {
    branchId: '',
    addressIds: [] as number[],
    userIds: [] as string[],
  };
  let token = '';
  let outsiderToken = '';

  const trace: unknown[] = [];
  const normalize = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value ?? null)
        .replace(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
          '<id>',
        )
        .split(tag)
        .join('<tag>'),
    ) as unknown;

  const upload = async (
    name: string,
    expected: number,
    file: Buffer | null,
    { branchId = ids.branchId, asToken = token } = {},
  ) => {
    let req = request(app.getHttpServer())
      .post(`/api/studies/import?branchId=${branchId}`)
      .set('Authorization', `Bearer ${asToken}`);
    if (file) {
      req = req.attach('file', file, {
        filename: 'estudios.xlsx',
        contentType: XLSX_TYPE,
      });
    }
    const res = await req;
    trace.push({ name, status: res.status, body: normalize(res.body) });
    expect({ name, status: res.status, body: res.body }).toMatchObject({
      name,
      status: expected,
    });
    return res.body as Record<string, any>;
  };

  const snapshot = async (name: string) => {
    const studies = await prisma.study.findMany({
      where: { branchId: ids.branchId },
      orderBy: { code: 'asc' },
      select: {
        code: true,
        name: true,
        title: true,
        slug: true,
        description: true,
        preparation: true,
        deliveryTime: true,
        isActive: true,
        abbreviation: true,
        isPanel: true,
        gender: true,
        ageFormat: true,
        minAge: true,
        maxAge: true,
        units: true,
        decimals: true,
        service: { select: { name: true } },
        section: { select: { name: true } },
        sampleType: { select: { name: true } },
        technique: { select: { name: true } },
        panelItems: {
          orderBy: { order: 'asc' },
          select: { order: true, child: { select: { code: true } } },
        },
        _count: { select: { priceSheets: true } },
      },
    });
    const catalogs = await Promise.all(
      [prisma.studySection, prisma.sampleType, prisma.studyTechnique].map(
        (delegate: any) =>
          delegate.findMany({
            where: { branchId: ids.branchId },
            orderBy: { name: 'asc' },
            select: { name: true, isActive: true },
          }) as Promise<unknown[]>,
      ),
    );
    trace.push({ name, studies: normalize(studies), catalogs });
    return studies;
  };

  const row = (code: string, overrides: Row = {}): Row => ({
    code,
    name: `Estudio ${code}`,
    serviceName: service,
    section: 'Química clínica',
    sampleType: 'Suero',
    technique: 'Colorimetría',
    ...overrides,
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
      return prisma.branch.create({
        data: {
          name: `${name} ${tag}`,
          urlResults: 'https://example.com',
          stateId: state.id,
          addressId: address.id,
        },
      });
    };
    ids.branchId = (await branch('Importación')).id;
    const otherBranch = (await branch('Ajena')).id;
    await prisma.service.create({
      data: {
        name: service,
        slug: `quimica-${tag}`,
        imageUrl: 'https://example.com/x.png',
        branchId: ids.branchId,
      },
    });

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
    token = await user('admin', [ids.branchId]);
    outsiderToken = await user('outsider', [otherBranch]);
  }, 60_000);

  afterAll(async () => {
    if (process.env.STUDY_IMPORT_E2E_TRACE) {
      writeFileSync(
        process.env.STUDY_IMPORT_E2E_TRACE,
        JSON.stringify(trace, null, 2),
      );
    }
    if (!prisma) return;
    const branchIds = (
      await prisma.branch.findMany({
        where: { name: { endsWith: tag } },
        select: { id: true },
      })
    ).map((b) => b.id);
    const where = { branchId: { in: branchIds } };
    const studyIds = (
      await prisma.study.findMany({ where, select: { id: true } })
    ).map((s) => s.id);
    await prisma.studyPanelItem.deleteMany({
      where: {
        OR: [{ panelId: { in: studyIds } }, { childId: { in: studyIds } }],
      },
    });
    await prisma.referenceValue.deleteMany({
      where: { studyId: { in: studyIds } },
    });
    await prisma.study.deleteMany({ where });
    await prisma.studySection.deleteMany({ where });
    await prisma.sampleType.deleteMany({ where });
    await prisma.studyTechnique.deleteMany({ where });
    await prisma.service.deleteMany({ where });
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    await prisma.address.deleteMany({ where: { id: { in: ids.addressIds } } });
    await app.close();
  }, 60_000);

  it('plantilla y errores de archivo o sucursal', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/studies/import-template?branchId=${ids.branchId}`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = XLSX.read(res.body as Buffer, { type: 'buffer' });
    trace.push({
      name: 'plantilla',
      sheets: workbook.SheetNames.map((sheet) =>
        normalize(XLSX.utils.sheet_to_json(workbook.Sheets[sheet])),
      ),
    });

    await upload('sin archivo', 400, null);
    await upload('sin acceso', 403, toExcel([row('A1')]), {
      asToken: outsiderToken,
    });
    await upload(
      'columnas faltantes',
      400,
      toExcel([{ code: 'A1', name: 'x' }]),
    );
    await upload('solo encabezados', 400, toExcel([]));
  });

  it('crea, actualiza, rechaza filas y arma perfiles', async () => {
    await upload(
      'primera carga',
      201,
      toExcel([
        row('GLU', {
          name: 'Glucosa',
          minAge: 0,
          maxAge: 99,
          units: 'mg/dL',
          decimals: 1,
        }),
        row('glu2', {
          name: 'Glucosa',
          title: 'Glucosa postprandial',
          gender: 'F',
          ageFormat: 'DIAS',
        }),
        row('GLU3', { name: 'Glucosa' }),
        row('INA', { isActive: 'false' }),
        row('PERF', { isPanel: 'true', parametros: 'GLU, GLU2' }),
        row('PERF2', { isPanel: 'true', parametros: 'PERF,GLU3' }),
        row('NOTECH', { technique: '', section: 'Hematología' }),
        row('PRICE', { price: 10 }),
        row('GLU'),
        row('NOSEC', { section: '' }),
        row('BADSVC', { serviceName: 'No existe' }),
        row('AGE', { minAge: 5 }),
        row('AGE2', { minAge: 9, maxAge: 1 }),
        row('PUNITS', { isPanel: 'true', units: 'mg' }),
        row('NOPANEL', { parametros: 'GLU' }),
        row('SELF', { isPanel: 'true', parametros: 'SELF' }),
        row('REP', { isPanel: 'true', parametros: 'GLU,GLU' }),
        row('MISSING', { isPanel: 'true', parametros: 'NOPE,GLU' }),
        row('WITHINA', { isPanel: 'true', parametros: 'INA' }),
        { code: '', name: '' },
        row('BADDEL', { deliveryTime: 'mañana' }),
      ]),
    );
    await snapshot('estado tras primera carga');

    await upload(
      'segunda carga',
      201,
      toExcel([
        row('GLU', {
          name: 'Glucosa sérica',
          section: '',
          sampleType: '',
          technique: '',
        }),
        row('GLU2', { isActive: 'false' }),
        row('PERF', { isPanel: 'false' }),
        row('PERF2', { isPanel: 'true', parametros: 'GLU3' }),
        row('GLU3', { isPanel: 'true', parametros: 'PERF2' }),
        row('NUEVO', {
          name: 'Glucosa',
          section: 'Inmunología',
          sampleType: 'Plasma',
        }),
        row('INA', { isActive: 'true', description: 'reactivado' }),
      ]),
    );
    await snapshot('estado tras segunda carga');

    // GLU2 is a child of PERF, which is a child of PERF2: making GLU2 contain
    // PERF2 closes a cycle with the branch's current panels.
    const third = await upload(
      'tercera carga',
      201,
      toExcel([
        row('GLU2', {
          isPanel: 'true',
          parametros: 'PERF2',
          name: 'No cambia',
        }),
        row('NUEVO2', { name: 'Glucosa' }),
      ]),
    );
    expect(third).toMatchObject({ processed: 1, created: 1 });
    expect(third.invalid).toEqual([
      {
        row: 2,
        code: 'GLU2',
        errors: [
          'Los parámetros forman un ciclo: algún perfil hijo contiene (directa o indirectamente) a este perfil',
        ],
      },
    ]);
    const studies = await snapshot('estado tras tercera carga');
    expect(studies.find((s) => s.code === 'GLU2')).toMatchObject({
      isPanel: false,
      name: 'Glucosa',
    });
  });
});
