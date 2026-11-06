import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { writeFileSync } from 'fs';
import request from 'supertest';
import { DeviceType } from '@prisma/client';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { CloudinaryService } from 'src/common/cloudinary/cloudinary.service';
import { MailService } from 'src/mail/mail.service';
import { MailQueueService } from 'src/mail/mail-queue.service';
import { SafeguardsService } from 'src/safeguards/safeguards.service';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { ensureE2eBaseData } from './support/e2e-seed';

/**
 * Device safeguards (`/safeguards`, ADM.F.18) end to end against a real
 * database: generated from assignments and on demand, versions, PDF,
 * signature and deletion. Cloudinary is mocked (external service). Creates
 * its own branches, employees, devices and users and deletes them afterwards.
 * With SAFEGUARDS_E2E_TRACE=<path> it writes every normalized response to a
 * file, to compare behavior before and after a refactor.
 */
describe('Resguardos de equipo (e2e)', () => {
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
    catalogs: {} as Record<string, string>,
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
      body: normalize(res.body),
    });
    expect({ name, status: res.status, body: res.body }).toMatchObject({
      name,
      status: expected,
    });
    return res.body as Record<string, any>;
  };

  const pdf = async (name: string, id: string) => {
    const res = await request(app.getHttpServer())
      .get(`/api/safeguards/${id}/pdf`)
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

  const device = async (
    key: string,
    catalog: string,
    extra: object = {},
  ): Promise<Record<string, any>> => {
    const created = await call(`equipo ${key}`, 201, 'post', '/devices', {
      internalCode: `${key}-${tag}`,
      serialNumber: `SN-${key}`,
      catalogId: ids.catalogs[catalog],
      currentBranchId: ids.branchA,
      condition: 'NEW',
      notes: `Notas ${key}`,
      ...extra,
    });
    labels.set(created.id, `<device:${key}>`);
    return created;
  };

  const current = async (employee: string) => {
    const found = await prisma.safeguard.findFirstOrThrow({
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

    for (const [key, position] of [
      ['ana', 'Química'],
      ['beto', null],
      ['carla', 'Recepción'],
    ] as const) {
      const employee = await prisma.employee.create({
        data: {
          name: `${key} ${tag}`,
          department: 'Laboratorio',
          position,
          branchId: ids.branchA,
        },
      });
      ids.employees[key] = employee.id;
      labels.set(employee.id, `<employee:${key}>`);
    }

    for (const type of [
      DeviceType.COMPUTER,
      DeviceType.MOBILE,
      DeviceType.MONITOR,
      DeviceType.KEYBOARD,
    ]) {
      const catalog = await prisma.deviceCatalog.create({
        data: {
          name: `${type} ${tag}`,
          type,
          brand: 'Marca',
          model: `M-${type}`,
        },
      });
      ids.catalogs[type] = catalog.id;
      labels.set(catalog.id, `<catalog:${type}>`);
    }

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
    if (process.env.SAFEGUARDS_E2E_TRACE) {
      writeFileSync(
        process.env.SAFEGUARDS_E2E_TRACE,
        JSON.stringify(trace, null, 2),
      );
    }
    if (!prisma) return;
    const branchIds = [ids.branchA, ids.branchB];
    await prisma.safeguard.deleteMany({
      where: { branchId: { in: branchIds } },
    });
    await prisma.deviceMovementHistory.deleteMany({
      where: { device: { internalCode: { endsWith: tag } } },
    });
    await prisma.deviceItem.deleteMany({
      where: { internalCode: { endsWith: tag } },
    });
    await prisma.deviceCatalog.deleteMany({
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

  it('genera, versiona, firma y elimina resguardos', async () => {
    const { employees, branchA } = ids;

    await call('sin equipos asignados', 400, 'post', '/safeguards', {
      employeeId: employees.ana,
      usageType: 'PERMANENT',
    });
    await call('empleado inexistente', 404, 'post', '/safeguards', {
      employeeId: branchA,
    });
    await call(
      'empleado de otra sucursal',
      403,
      'post',
      '/safeguards',
      { employeeId: employees.ana },
      outsiderToken,
    );

    // Generado al asignar: computadora con sus accesorios
    const pc = await device('PC', 'COMPUTER', {
      processor: 'i7',
      hardDrive: '512 GB',
    });
    await device('MON', 'MONITOR', { mainDeviceId: pc.id });
    await device('TEC', 'KEYBOARD', {
      mainDeviceId: pc.id,
      serialNumber: null,
    });
    const phone = await device('CEL', 'MOBILE', {
      imei: '356789',
      phoneNumber: '5551234567',
    });
    await call('asignar computadora', 201, 'post', `/devices/${pc.id}/assign`, {
      employeeId: employees.ana,
      usageType: 'PERMANENT',
    });
    const v1 = await current('ana');
    labels.set(v1, '<safeguard:v1>');
    await call(
      'asignar celular (hereda el uso)',
      201,
      'post',
      `/devices/${phone.id}/assign`,
      { employeeId: employees.ana, mobileAccessories: ['Cargador'] },
    );
    const v2 = await current('ana');
    labels.set(v2, '<safeguard:v2>');

    // Generado a mano
    await call('temporal sin fecha de inicio', 400, 'post', '/safeguards', {
      employeeId: employees.ana,
      usageType: 'TEMPORARY',
    });
    const v3 = await call(
      'temporal con accesorios',
      201,
      'post',
      '/safeguards',
      {
        employeeId: employees.ana,
        usageType: 'TEMPORARY',
        startDate: '2026-11-01',
        endDate: '2026-12-31',
        mobileAccessories: ['Cargador', 'Funda'],
      },
    );
    labels.set(v3.id, '<safeguard:v3>');
    const v4 = await call(
      'conserva accesorios y fechas',
      201,
      'post',
      '/safeguards',
      { employeeId: employees.ana },
    );
    labels.set(v4.id, '<safeguard:v4>');

    // Consultas
    await call(
      'vigentes de la sucursal',
      200,
      'get',
      `/safeguards?branchId=${branchA}`,
    );
    await call(
      'con historial',
      200,
      'get',
      `/safeguards?employeeId=${employees.ana}&includeHistory=true&sort[field]=createdAt&sort[order]=asc`,
    );
    await call('búsqueda por nombre', 200, 'get', `/safeguards?search=ana`);
    await call(
      'lista sin acceso',
      403,
      'get',
      `/safeguards?branchId=${branchA}`,
      undefined,
      outsiderToken,
    );
    await call('detalle vigente', 200, 'get', `/safeguards/${v4.id}`);
    await call('detalle histórico', 200, 'get', `/safeguards/${v1}`);
    await call(
      'detalle sin acceso',
      403,
      'get',
      `/safeguards/${v4.id}`,
      undefined,
      outsiderToken,
    );
    await call('detalle inexistente', 404, 'get', `/safeguards/${branchA}`);
    await pdf('pdf vigente', v4.id);
    await pdf('pdf histórico', v1);

    // Documento firmado (Cloudinary simulado)
    await call(
      'firma de subida histórica',
      400,
      'post',
      `/safeguards/${v2}/upload-signature`,
    );
    await call(
      'firma de subida',
      201,
      'post',
      `/safeguards/${v4.id}/upload-signature`,
    );
    await call(
      'sin documento firmado',
      404,
      'get',
      `/safeguards/${v4.id}/signed-document`,
    );
    await call(
      'firmar histórico',
      400,
      'post',
      `/safeguards/${v3.id}/sign`,
      {},
    );
    await call('firmar', 201, 'post', `/safeguards/${v4.id}/sign`, {
      signedDocumentPublicId: `safeguards/device-${v4.id}-1700000000000`,
    });
    expect(
      (
        await prisma.employee.findUniqueOrThrow({
          where: { id: employees.ana },
        })
      ).hasSignedResponsibility,
    ).toBe(true);
    await call(
      'documento firmado',
      200,
      'get',
      `/safeguards/${v4.id}/signed-document`,
    );
    await call(
      'firmar sin documento',
      201,
      'post',
      `/safeguards/${v4.id}/sign`,
      {},
    );

    // Nueva versión al reasignar: vuelve a quedar sin firmar
    await call('liberar celular', 201, 'post', `/devices/${phone.id}/unassign`);
    const v5 = await call('solo computadora', 201, 'post', '/safeguards', {
      employeeId: employees.ana,
    });
    labels.set(v5.id, '<safeguard:v5>');
    expect(
      (
        await prisma.employee.findUniqueOrThrow({
          where: { id: employees.ana },
        })
      ).hasSignedResponsibility,
    ).toBe(false);

    // Baja
    await call('borrar histórico', 400, 'delete', `/safeguards/${v4.id}`);
    await call(
      'borrar sin acceso',
      403,
      'delete',
      `/safeguards/${v5.id}`,
      undefined,
      outsiderToken,
    );
    await call('borrar vigente', 200, 'delete', `/safeguards/${v5.id}`);
    await call(
      'vigentes tras borrar',
      200,
      'get',
      `/safeguards?employeeId=${employees.ana}`,
    );

    // Cierre al dar de baja al empleado (EmployeesService)
    const phone2 = await device('CEL2', 'MOBILE');
    await call('asignar a carla', 201, 'post', `/devices/${phone2.id}/assign`, {
      employeeId: employees.carla,
      usageType: 'PERMANENT',
    });
    await prisma.$transaction((tx) =>
      app.get(SafeguardsService).closeCurrentForEmployee(tx, employees.carla),
    );
    await call(
      'carla sin vigente',
      200,
      'get',
      `/safeguards?employeeId=${employees.carla}`,
    );
    await call(
      'carla con historial',
      200,
      'get',
      `/safeguards?employeeId=${employees.carla}&includeHistory=true`,
    );
  });
});
