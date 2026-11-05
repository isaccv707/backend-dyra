import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { writeFileSync } from 'fs';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { Category, Prisma } from '@prisma/client';
import { AppModule } from 'src/app.module';
import { CATEGORY_LABELS } from 'src/tickets/tickets.shared';
import { configureApp } from 'src/app.setup';
import { MailService } from 'src/mail/mail.service';
import { MailQueueService } from 'src/mail/mail-queue.service';
import { PrismaService } from 'prisma/prisma/prisma.service';

/**
 * Ticket analytics (`/tickets/analytics/*`) end to end against a real
 * database, over tickets with fixed dates in two branches of its own (deleted
 * afterwards). With TICKETS_ANALYTICS_E2E_TRACE=<path> it writes every
 * normalized response to a file, to compare behavior before and after a
 * refactor.
 */
describe('Analítica de tickets (e2e)', () => {
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
  const tokens = { ti: '', single: '', outsider: '', noPermission: '' };

  const trace: unknown[] = [];
  /** Readable labels for the ids this suite creates (users, subcategories). */
  const labels = new Map<string, string>();
  const byRank = (row: unknown) =>
    typeof row === 'object' && row !== null
      ? Number(
          (row as { total?: number; count?: number }).total ??
            (row as { count?: number }).count ??
            0,
        )
      : 0;
  /**
   * Rows that tie on total/count come back in Postgres' grouping order, which
   * depends on random UUIDs: the trace sorts ties so two runs compare equal.
   */
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value
        .map(canonical)
        .sort(
          (a, b) =>
            byRank(b) - byRank(a) ||
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
        );
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, canonical(v)]),
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
          .split(tag)
          .join('<tag>'),
      ),
    );
  /**
   * The API sorts every breakdown by total/count, highest first, and ties by
   * name (users, assignees, subcategories) or category label.
   */
  const labelOf = (row: unknown) => {
    const { name, category } = row as { name?: string; category?: Category };
    return name ?? (category ? CATEGORY_LABELS[category] : '');
  };
  const expectRanked = (rows: unknown[]) => {
    const expected = [...rows].sort(
      (a, b) =>
        byRank(b) - byRank(a) || labelOf(a).localeCompare(labelOf(b), 'es'),
    );
    expect(rows.map(labelOf)).toEqual(expected.map(labelOf));
  };
  const expectDescending = (rows: unknown) => {
    if (!Array.isArray(rows)) return;
    expectRanked(rows);
    for (const row of rows as { subcategories?: unknown[] }[]) {
      if (row.subcategories) expectRanked(row.subcategories);
    }
  };

  const get = async (
    name: string,
    expected: number,
    url: string,
    token = tokens.ti,
  ) => {
    const res = await request(app.getHttpServer())
      .get(`/api/tickets/analytics/${url}`)
      .set('Authorization', `Bearer ${token}`);
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
    expectDescending(res.body);
    return res.body as unknown;
  };

  const ENDPOINTS = ['summary', 'by-user', 'by-assignee', 'by-category'];

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
      return (
        await prisma.branch.create({
          data: {
            name: `${name} ${tag}`,
            urlResults: 'https://example.com',
            stateId: state.id,
            addressId: address.id,
          },
        })
      ).id;
    };
    ids.branchA = await branch('Matriz');
    ids.branchB = await branch('Norte');
    labels.set(ids.branchA, '<branch:matriz>');
    labels.set(ids.branchB, '<branch:norte>');
    const otherBranch = await branch('Ajena');

    const hash = await bcrypt.hash(password, 10);
    const user = async (
      prefix: string,
      role: string,
      branches: string[],
      login = true,
    ) => {
      const email = `${prefix}.${tag}@example.com`;
      const created = await prisma.user.create({
        data: {
          email,
          name: `${prefix} ${tag}`,
          password: hash,
          role: { connect: { name: role } },
          branches: { connect: branches.map((id) => ({ id })) },
        },
      });
      ids.userIds.push(created.id);
      labels.set(created.id, `<user:${prefix}>`);
      if (!login) return { id: created.id, token: '' };
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
      return {
        id: created.id,
        token: (res.body as { access_token: string }).access_token,
      };
    };
    tokens.ti = (
      await user('ti', 'Administrador', [ids.branchA, ids.branchB])
    ).token;
    tokens.single = (
      await user('matriz', 'Administrador', [ids.branchA])
    ).token;
    tokens.outsider = (
      await user('ajeno', 'Administrador', [otherBranch])
    ).token;
    tokens.noPermission = (
      await user('usuario', 'Usuario', [ids.branchA])
    ).token;
    const ana = (await user('ana', 'Usuario', [ids.branchA], false)).id;
    const beto = (await user('beto', 'Usuario', [ids.branchA], false)).id;
    const techA = (await user('tec1', 'Usuario', [ids.branchA], false)).id;
    const techB = (await user('tec2', 'Usuario', [ids.branchA], false)).id;

    const subcategory = async (
      category: 'HARDWARE' | 'SOFTWARE',
      name: string,
    ) => {
      const created = await prisma.ticketSubcategory.create({
        data: { category, name: `${name} ${tag}` },
      });
      ids.subcategoryIds.push(created.id);
      labels.set(created.id, `<subcategory:${name}>`);
      return created.id;
    };
    const printers = await subcategory('HARDWARE', 'Impresoras');
    const screens = await subcategory('HARDWARE', 'Pantallas');
    const office = await subcategory('SOFTWARE', 'Office');

    const at = (iso: string) => new Date(iso);
    const tickets: Array<
      Omit<Prisma.TicketUncheckedCreateInput, 'code' | 'title'> & {
        assigneeIds?: string[];
      }
    > = [
      {
        branchId: ids.branchA,
        status: 'OPEN',
        priority: 'HIGH',
        category: 'HARDWARE',
        subcategoryId: printers,
        createdById: ana,
        createdAt: at('2026-03-02T15:00:00Z'),
        dueAt: at('2026-03-03T15:00:00Z'),
        assigneeIds: [techA],
      },
      {
        branchId: ids.branchA,
        status: 'RESOLVED',
        priority: 'MEDIUM',
        category: 'HARDWARE',
        subcategoryId: printers,
        createdById: ana,
        // 23:00 del 1 de marzo en hora del laboratorio: cae en el día local anterior.
        createdAt: at('2026-03-02T05:00:00Z'),
        firstResponseAt: at('2026-03-02T06:00:00Z'),
        resolvedAt: at('2026-03-02T10:00:00Z'),
        reopenedCount: 1,
        dueAt: at('2026-03-04T05:00:00Z'),
        assigneeIds: [techA, techB],
      },
      {
        branchId: ids.branchA,
        status: 'CLOSED',
        priority: 'LOW',
        category: 'SOFTWARE',
        subcategoryId: office,
        createdById: beto,
        createdAt: at('2026-03-10T18:00:00Z'),
        firstResponseAt: at('2026-03-10T19:30:00Z'),
        resolvedAt: at('2026-03-12T18:00:00Z'),
        closedAt: at('2026-03-13T18:00:00Z'),
        assigneeIds: [techB],
      },
      {
        branchId: ids.branchA,
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        category: 'SOFTWARE',
        createdById: beto,
        createdAt: at('2026-04-01T16:00:00Z'),
        reopenedCount: 2,
        dueAt: at('2099-01-01T00:00:00Z'),
      },
      {
        branchId: ids.branchA,
        status: 'CANCELLED',
        priority: 'CRITICAL',
        category: 'ACCESS',
        createdById: ana,
        createdAt: at('2026-04-15T17:00:00Z'),
        dueAt: at('2026-04-15T18:00:00Z'),
      },
      {
        branchId: ids.branchA,
        status: 'RESOLVED',
        priority: 'MEDIUM',
        category: 'HARDWARE',
        subcategoryId: screens,
        createdById: beto,
        createdAt: at('2026-04-20T15:00:00Z'),
        firstResponseAt: at('2026-04-20T15:20:00Z'),
        resolvedAt: at('2026-04-27T15:00:00Z'),
        assigneeIds: [techA],
      },
      {
        branchId: ids.branchB,
        status: 'ON_HOLD',
        priority: 'LOW',
        category: 'OTHER',
        createdById: ana,
        createdAt: at('2026-03-05T20:00:00Z'),
        dueAt: at('2026-03-06T20:00:00Z'),
        assigneeIds: [techB],
      },
    ];
    for (const [index, { assigneeIds, ...data }] of tickets.entries()) {
      await prisma.ticket.create({
        data: {
          ...data,
          code: index + 1,
          title: `Ticket ${index + 1} ${tag}`,
          assignees: assigneeIds && {
            create: assigneeIds.map((userId) => ({ userId })),
          },
        },
      });
    }
  }, 60_000);

  afterAll(async () => {
    if (process.env.TICKETS_ANALYTICS_E2E_TRACE) {
      writeFileSync(
        process.env.TICKETS_ANALYTICS_E2E_TRACE,
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
    await prisma.ticket.deleteMany({ where: { branchId: { in: branchIds } } });
    await prisma.ticketSubcategory.deleteMany({
      where: { id: { in: ids.subcategoryIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    await prisma.address.deleteMany({ where: { id: { in: ids.addressIds } } });
    await app.close();
  }, 60_000);

  it('métricas con y sin filtros', async () => {
    const { branchA, branchB } = ids;
    const filters: Array<[string, string]> = [
      ['todas mis sucursales', ''],
      ['sucursal matriz', `branchId=${branchA}`],
      ['sucursal norte', `branchId=${branchB}`],
      [
        'marzo (fechas locales)',
        `branchId=${branchA}&from=2026-03-01&to=2026-03-31`,
      ],
      [
        'un solo día local',
        `branchId=${branchA}&from=2026-03-01&to=2026-03-01`,
      ],
      ['rango ISO', `from=2026-03-02T00:00:00Z&to=2026-04-01T16:00:00Z`],
      ['solo desde', `branchId=${branchA}&from=2026-04-01`],
      ['solo hasta', `branchId=${branchA}&to=2026-03-10`],
      ['categoría', `branchId=${branchA}&category=HARDWARE`],
      ['prioridad', `priority=HIGH`],
      ['sin resultados', `branchId=${branchA}&category=COGNITI`],
    ];
    for (const [label, query] of filters) {
      for (const endpoint of ENDPOINTS) {
        await get(`${endpoint}: ${label}`, 200, `${endpoint}?${query}`);
      }
    }
    await get('usuario de una sucursal', 200, 'summary', tokens.single);
  });

  it('tendencia por día, semana y mes', async () => {
    for (const interval of ['day', 'week', 'month']) {
      await get(
        `trend ${interval}`,
        200,
        `trend?interval=${interval}&branchId=${ids.branchA}`,
      );
    }
    await get('trend por defecto', 200, 'trend');
    await get(
      'trend filtrado',
      200,
      'trend?interval=week&category=HARDWARE&from=2026-03-01&to=2026-04-30',
    );
    await get('trend intervalo inválido', 400, 'trend?interval=year');
  });

  it('errores de filtros y permisos', async () => {
    await get(
      'fecha inicial posterior',
      400,
      `summary?from=2026-04-02&to=2026-04-01`,
    );
    await get(
      'fecha ISO invertida',
      400,
      `by-user?from=2026-04-02T00:00:00Z&to=2026-04-01T00:00:00Z`,
    );
    await get(
      'mismo instante ISO',
      200,
      `by-category?from=2026-03-02T05:00:00Z&to=2026-03-02T05:00:00Z`,
    );
    await get('fecha inválida', 400, 'summary?from=ayer');
    await get('categoría inválida', 400, 'by-category?category=NOPE');
    await get(
      'sucursal ajena',
      403,
      `summary?branchId=${ids.branchA}`,
      tokens.outsider,
    );
    await get('sin permiso', 403, 'summary', tokens.noPermission);
  });

  it('exporta xlsx y pdf', async () => {
    const download = async (name: string, query: string) => {
      const res = await request(app.getHttpServer())
        .get(`/api/tickets/analytics/export?${query}`)
        .set('Authorization', `Bearer ${tokens.ti}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const body = res.body as Buffer;
      const entry: Record<string, unknown> = {
        name,
        contentType: res.headers['content-type'],
        disposition: res.headers['content-disposition'],
      };
      if (String(res.headers['content-type']).includes('pdf')) {
        // Solo se verifica el formato: pdfkit comprime el texto y fecha el archivo.
        entry.isPdf = body.subarray(0, 5).toString() === '%PDF-';
      } else {
        const workbook = XLSX.read(body, { type: 'buffer' });
        entry.sheets = workbook.SheetNames.map((sheet) => ({
          sheet,
          rows: normalize(XLSX.utils.sheet_to_json(workbook.Sheets[sheet])),
        }));
      }
      trace.push(entry);
    };
    await download('xlsx por defecto', `branchId=${ids.branchA}`);
    await download(
      'xlsx filtrado',
      `format=xlsx&from=2026-03-01&to=2026-03-31&priority=MEDIUM`,
    );
    await download(
      'pdf con filtros',
      `format=pdf&branchId=${ids.branchA}&from=2026-03-01&to=2026-04-30&category=HARDWARE&priority=HIGH`,
    );
    await download('pdf sin filtros', 'format=pdf');
    await get('formato inválido', 400, 'export?format=csv');
  });
});
