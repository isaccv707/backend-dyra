import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { writeFileSync } from 'fs';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { CloudinaryService } from 'src/common/cloudinary/cloudinary.service';
import { MailService } from 'src/mail/mail.service';
import { MailQueueService } from 'src/mail/mail-queue.service';
import { VehicleSafeguardsService } from 'src/vehicle-safeguards/vehicle-safeguards.service';
import { PrismaService } from 'prisma/prisma/prisma.service';

/**
 * Vehicle safeguards (`/vehicle-safeguards`, ADM.F.01) end to end against a
 * real database: generated from assignments and on demand, inspection
 * checklist, versions, PDF, signature and deletion. Cloudinary is mocked
 * (external service). Creates its own branches, employees, vehicles and users
 * and deletes them afterwards. With VEHICLE_SAFEGUARDS_E2E_TRACE=<path> it
 * writes every normalized response to a file, to compare behavior before and
 * after a refactor.
 */
describe('Resguardos de vehículo (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `e2e-${Date.now().toString(36)}`;
  const password = `E2e-${Math.random().toString(36).slice(2)}!`;
  const cloudinary = {
    generateSignedUploadParams: jest.fn((publicId: string) => ({
      publicId,
      signature: 'firma-de-prueba',
    })),
    getSignedDownloadUrl: jest.fn((publicId: string) => ({
      url: `https://cdn.example.com/${publicId}`,
    })),
  };
  const ids = {
    branchA: '',
    branchB: '',
    addressIds: [] as number[],
    userIds: [] as string[],
    employees: {} as Record<string, string>,
    catalog: '',
  };
  let token = '';
  let outsiderToken = '';

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
        // Cloudinary public ids end in Date.now().
        .replace(/-\d{13}\b/g, '-<ts>')
        .replace(/"(addressId)":\d+/g, '"$1":"<n>"')
        .split(tag)
        .join('<tag>'),
    ) as unknown;
  /** Inspection items have no orderBy: the trace sorts them by key. */
  const sortItems = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortItems);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === 'inspectionItems' && Array.isArray(v)
          ? [...(v as { itemKey: string }[])].sort((a, b) =>
              a.itemKey.localeCompare(b.itemKey),
            )
          : sortItems(v),
      ]),
    );
  };

  type Method = 'get' | 'post' | 'delete';
  const call = async (
    name: string,
    expected: number,
    method: Method,
    url: string,
    body?: object,
    asToken = token,
  ) => {
    const req = request(app.getHttpServer())
      [method](`/api${url}`)
      .set('Authorization', `Bearer ${asToken}`);
    const res = await (body ? req.send(body) : req);
    trace.push({
      name,
      status: res.status,
      url: normalize(url),
      body: sortItems(normalize(res.body)),
    });
    expect({ name, status: res.status, body: res.body }).toMatchObject({
      name,
      status: expected,
    });
    return res.body as Record<string, any>;
  };

  const pdf = async (name: string, id: string) => {
    const res = await request(app.getHttpServer())
      .get(`/api/vehicle-safeguards/${id}/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    trace.push({
      name,
      contentType: res.headers['content-type'],
      disposition: normalize(res.headers['content-disposition']),
      // Only the format: pdfkit compresses the text and stamps the date.
      isPdf: (res.body as Buffer).subarray(0, 5).toString() === '%PDF-',
    });
  };

  const vehicle = async (key: string) => {
    const created = await call(`vehículo ${key}`, 201, 'post', '/vehicles', {
      internalCode: `${key}-${tag}`,
      plateNumber: `${key}-${tag}`,
      mileage: '12000',
      fuelType: 'Gasolina',
      transmission: 'Manual',
      catalogId: ids.catalog,
      currentBranchId: ids.branchA,
      condition: 'SEMINUEVO',
    });
    labels.set(created.id, `<vehicle:${key}>`);
    return created;
  };

  const current = async (employee: string) => {
    const found = await prisma.vehicleSafeguard.findFirstOrThrow({
      where: { employeeId: ids.employees[employee], supersededAt: null },
      select: { id: true },
    });
    return found.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({})
      .overrideProvider(MailQueueService)
      .useValue({ enqueue: jest.fn() })
      .overrideProvider(CloudinaryService)
      .useValue(cloudinary)
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

    for (const [key, position] of [
      ['ana', 'Chofer'],
      ['beto', null],
      ['carla', 'Mensajería'],
    ] as const) {
      const employee = await prisma.employee.create({
        data: {
          name: `${key} ${tag}`,
          department: 'Logística',
          position,
          branchId: ids.branchA,
        },
      });
      ids.employees[key] = employee.id;
      labels.set(employee.id, `<employee:${key}>`);
    }
    ids.catalog = (
      await prisma.vehicleCatalog.create({
        data: { name: `Pick-up ${tag}`, brand: 'Marca', model: 'P-1' },
      })
    ).id;
    labels.set(ids.catalog, '<catalog>');

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
      labels.set(created.id, `<user:${prefix}>`);
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
    if (process.env.VEHICLE_SAFEGUARDS_E2E_TRACE) {
      writeFileSync(
        process.env.VEHICLE_SAFEGUARDS_E2E_TRACE,
        JSON.stringify(trace, null, 2),
      );
    }
    if (!prisma) return;
    const branchIds = [ids.branchA, ids.branchB];
    await prisma.vehicleSafeguard.deleteMany({
      where: { branchId: { in: branchIds } },
    });
    await prisma.vehicleMovementHistory.deleteMany({
      where: { vehicle: { internalCode: { endsWith: tag } } },
    });
    await prisma.vehicleItem.deleteMany({
      where: { internalCode: { endsWith: tag } },
    });
    await prisma.vehicleCatalog.deleteMany({
      where: { name: { endsWith: tag } },
    });
    await prisma.employee.deleteMany({
      where: { branchId: { in: branchIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    await prisma.address.deleteMany({ where: { id: { in: ids.addressIds } } });
    await app.close();
  }, 60_000);

  it('genera, versiona, firma y elimina resguardos de vehículo', async () => {
    const { employees, branchA } = ids;
    const url = '/vehicle-safeguards';

    await call('sin vehículo asignado', 400, 'post', url, {
      employeeId: employees.ana,
      usageType: 'PERMANENT',
    });
    await call('empleado inexistente', 404, 'post', url, {
      employeeId: branchA,
    });
    await call(
      'empleado de otra sucursal',
      403,
      'post',
      url,
      { employeeId: employees.ana },
      outsiderToken,
    );

    // Generado al asignar, con checklist
    const car = await vehicle('V1');
    await call(
      'asignar con checklist',
      201,
      'post',
      `/vehicles/${car.id}/assign`,
      {
        employeeId: employees.ana,
        usageType: 'PERMANENT',
        inspectionItems: [
          { itemKey: 'tarjeta_circulacion', state: 'Bien' },
          { itemKey: 'capote', state: 'Rayado', observations: 'Lado derecho' },
        ],
      },
    );
    const v1 = await current('ana');
    labels.set(v1, '<safeguard:v1>');

    // Generado a mano
    const v2 = await call('conserva checklist y uso', 201, 'post', url, {
      employeeId: employees.ana,
    });
    labels.set(v2.id, '<safeguard:v2>');
    await call('itemKey repetido', 400, 'post', url, {
      employeeId: employees.ana,
      inspectionItems: [{ itemKey: 'manuales' }, { itemKey: 'manuales' }],
    });
    await call('itemKey inválido', 400, 'post', url, {
      employeeId: employees.ana,
      inspectionItems: [{ itemKey: 'nope' }],
    });
    await call('temporal sin fecha de inicio', 400, 'post', url, {
      employeeId: employees.ana,
      usageType: 'TEMPORARY',
    });
    const v3 = await call('temporal con checklist nuevo', 201, 'post', url, {
      employeeId: employees.ana,
      usageType: 'TEMPORARY',
      startDate: '2026-11-01',
      endDate: '2026-12-31',
      inspectionItems: [{ itemKey: 'licencia_conducir', state: 'Vigente' }],
    });
    labels.set(v3.id, '<safeguard:v3>');

    // Otro vehículo: hereda uso y fechas, no el checklist
    await call('liberar V1', 201, 'post', `/vehicles/${car.id}/unassign`);
    const car2 = await vehicle('V2');
    await call('asignar V2', 201, 'post', `/vehicles/${car2.id}/assign`, {
      employeeId: employees.ana,
    });
    const v4 = await current('ana');
    labels.set(v4, '<safeguard:v4>');

    // Consultas
    await call(
      'vigentes de la sucursal',
      200,
      'get',
      `${url}?branchId=${branchA}`,
    );
    await call(
      'con historial',
      200,
      'get',
      `${url}?employeeId=${employees.ana}&includeHistory=true&sort[field]=createdAt&sort[order]=asc`,
    );
    await call('búsqueda por nombre', 200, 'get', `${url}?search=ana`);
    await call(
      'lista sin acceso',
      403,
      'get',
      `${url}?branchId=${branchA}`,
      undefined,
      outsiderToken,
    );
    await call('detalle vigente', 200, 'get', `${url}/${v4}`);
    await call('detalle histórico', 200, 'get', `${url}/${v1}`);
    await call(
      'detalle sin acceso',
      403,
      'get',
      `${url}/${v4}`,
      undefined,
      outsiderToken,
    );
    await call('detalle inexistente', 404, 'get', `${url}/${branchA}`);
    await pdf('pdf vigente', v4);
    await pdf('pdf con checklist', v1);

    // Documento firmado (Cloudinary simulado)
    await call(
      'firma de subida histórica',
      400,
      'post',
      `${url}/${v2.id}/upload-signature`,
    );
    await call('firma de subida', 201, 'post', `${url}/${v4}/upload-signature`);
    await call(
      'sin documento firmado',
      404,
      'get',
      `${url}/${v4}/signed-document`,
    );
    await call('firmar histórico', 400, 'post', `${url}/${v3.id}/sign`, {});
    await call('firmar', 201, 'post', `${url}/${v4}/sign`, {
      signedDocumentPublicId: `safeguards/vehicle-${v4}-1700000000000`,
    });
    await call('documento firmado', 200, 'get', `${url}/${v4}/signed-document`);
    await call('firmar sin documento', 201, 'post', `${url}/${v4}/sign`, {});

    // Baja
    await call('borrar histórico', 400, 'delete', `${url}/${v3.id}`);
    await call(
      'borrar sin acceso',
      403,
      'delete',
      `${url}/${v4}`,
      undefined,
      outsiderToken,
    );
    await call('borrar vigente', 200, 'delete', `${url}/${v4}`);
    await call(
      'vigentes tras borrar',
      200,
      'get',
      `${url}?employeeId=${employees.ana}`,
    );

    // Cierre al dar de baja al empleado (EmployeesService)
    const car3 = await vehicle('V3');
    await call('asignar a carla', 201, 'post', `/vehicles/${car3.id}/assign`, {
      employeeId: employees.carla,
      usageType: 'PERMANENT',
    });
    await prisma.$transaction((tx) =>
      app
        .get(VehicleSafeguardsService)
        .closeCurrentForEmployee(tx, employees.carla),
    );
    await call(
      'carla sin vigente',
      200,
      'get',
      `${url}?employeeId=${employees.carla}`,
    );
    await call(
      'carla con historial',
      200,
      'get',
      `${url}?employeeId=${employees.carla}&includeHistory=true`,
    );
  });
});
