import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { writeFileSync } from 'fs';
import request from 'supertest';
import {
  DeviceType,
  SafeguardConditionState,
  SafeguardUsageType,
} from '@prisma/client';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { DevicesService } from 'src/devices/devices.service';
import { MailService } from 'src/mail/mail.service';
import { MailQueueService } from 'src/mail/mail-queue.service';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { ensureE2eBaseData } from './support/e2e-seed';

/**
 * Devices and transfers end to end against a real database. Creates its own
 * branches, users and catalogs and deletes them afterwards. With
 * DEVICES_E2E_TRACE=<path> it also writes every normalized response to a file,
 * to compare behavior before and after a refactor.
 */
describe('Equipos y traspasos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `e2e-${Date.now().toString(36)}`;
  const password = `E2e-${Math.random().toString(36).slice(2)}!`;
  const condition = Object.values(SafeguardConditionState)[0];
  const usageType = Object.values(SafeguardUsageType)[0];

  const ids = {
    branchA: '',
    branchB: '',
    addressIds: [] as number[],
    employee: '',
    employee2: '',
    inactiveEmployee: '',
    foreignEmployee: '',
    location: '',
    computerCatalog: '',
    mobileCatalog: '',
    monitorCatalog: '',
    userIds: [] as string[],
  };
  let token = '';
  let outsiderToken = '';

  const trace: unknown[] = [];
  const known = new Map<string, string>();
  const normalize = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value ?? null)
        .replace(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
          (id) => {
            if (!known.has(id)) known.set(id, `<id-${known.size}>`);
            return known.get(id)!;
          },
        )
        .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<date>')
        .split(tag)
        .join('<tag>'),
    ) as unknown;

  type Method = 'get' | 'post' | 'patch';
  const step = async <T = Record<string, any>>(
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
    return res.body as T;
  };

  const device = (internalCode: string, catalogId: string, extra = {}) => ({
    internalCode: `${internalCode}-${tag}`,
    catalogId,
    currentBranchId: ids.branchA,
    condition,
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

    await ensureE2eBaseData(prisma);

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
    ids.branchA = (await branch('Origen')).id;
    ids.branchB = (await branch('Destino')).id;

    const employee = async (name: string, branchId: string, isActive = true) =>
      (
        await prisma.employee.create({
          data: {
            name: `${name} ${tag}`,
            department: 'TI',
            branchId,
            isActive,
          },
        })
      ).id;
    ids.employee = await employee('Ana', ids.branchA);
    ids.employee2 = await employee('Beto', ids.branchA);
    ids.inactiveEmployee = await employee('Baja', ids.branchA, false);
    ids.foreignEmployee = await employee('Ajeno', ids.branchB);
    ids.location = (
      await prisma.location.create({
        data: { name: `Recepción ${tag}`, branchId: ids.branchA },
      })
    ).id;

    const catalog = async (type: DeviceType) =>
      (
        await prisma.deviceCatalog.create({
          data: {
            name: `${type} ${tag}`,
            type,
            brand: 'E2E',
            model: `${type}-${tag}`,
          },
        })
      ).id;
    ids.computerCatalog = await catalog(DeviceType.COMPUTER);
    ids.mobileCatalog = await catalog(DeviceType.MOBILE);
    ids.monitorCatalog = await catalog(DeviceType.MONITOR);

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
    token = await user('admin', [ids.branchA, ids.branchB]);
    outsiderToken = await user('outsider', [ids.branchB]);
  }, 60_000);

  afterAll(async () => {
    if (process.env.DEVICES_E2E_TRACE) {
      writeFileSync(
        process.env.DEVICES_E2E_TRACE,
        JSON.stringify(trace, null, 2),
      );
    }
    if (!prisma) return;
    const branches = [ids.branchA, ids.branchB].filter(Boolean);
    await prisma.transferRequest.deleteMany({
      where: { originBranchId: { in: branches } },
    });
    await prisma.safeguard.deleteMany({
      where: { branchId: { in: branches } },
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
    await prisma.employee.deleteMany({ where: { branchId: { in: branches } } });
    await prisma.location.deleteMany({ where: { branchId: { in: branches } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: branches } } });
    await prisma.address.deleteMany({ where: { id: { in: ids.addressIds } } });
    await app.close();
  }, 60_000);

  it('alta, validaciones, asignación, accesorios y baja', async () => {
    const { computerCatalog, mobileCatalog, monitorCatalog } = ids;

    await step(
      'alta sin acceso',
      403,
      'post',
      '/devices',
      device('X0', computerCatalog),
      outsiderToken,
    );
    await step(
      'empleado y ubicación',
      400,
      'post',
      '/devices',
      device('X1', computerCatalog, {
        employeeId: ids.employee,
        locationId: ids.location,
      }),
    );
    await step(
      'catálogo inexistente',
      404,
      'post',
      '/devices',
      device('X2', ids.branchA),
    );
    await step(
      'imei en computadora',
      400,
      'post',
      '/devices',
      device('X3', computerCatalog, { imei: '1' }),
    );
    await step(
      'procesador en celular',
      400,
      'post',
      '/devices',
      device('X4', mobileCatalog, { processor: 'i7' }),
    );
    await step(
      'mainDevice en computadora',
      400,
      'post',
      '/devices',
      device('X5', computerCatalog, { mainDeviceId: ids.branchA }),
    );
    await step(
      'accesorio con empleado',
      400,
      'post',
      '/devices',
      device('X6', monitorCatalog, { employeeId: ids.employee }),
    );
    await step(
      'empleado ajeno',
      400,
      'post',
      '/devices',
      device('X7', computerCatalog, {
        employeeId: ids.foreignEmployee,
        usageType,
      }),
    );
    await step(
      'empleado de baja',
      400,
      'post',
      '/devices',
      device('X8', computerCatalog, {
        employeeId: ids.inactiveEmployee,
        usageType,
      }),
    );
    await step(
      'primera responsiva sin usageType',
      400,
      'post',
      '/devices',
      device('X9', computerCatalog, { employeeId: ids.employee }),
    );

    const pc = await step(
      'alta disponible',
      201,
      'post',
      '/devices',
      device('PC1', computerCatalog, { processor: 'i7' }),
    );
    await step(
      'código duplicado',
      409,
      'post',
      '/devices',
      device('PC1', computerCatalog),
    );
    const assignedPc = await step(
      'alta asignada',
      201,
      'post',
      '/devices',
      device('PC2', computerCatalog, { employeeId: ids.employee2, usageType }),
    );
    await step(
      'segundo equipo mismo tipo',
      400,
      'post',
      `/devices/${pc.id}/assign`,
      { employeeId: ids.employee2 },
    );

    await step('detalle', 200, 'get', `/devices/${pc.id}`);
    await step('detalle inexistente', 404, 'get', `/devices/${ids.branchA}`);
    await step(
      'lista filtrada',
      200,
      'get',
      `/devices?branchId=${ids.branchA}&employeeId=${ids.employee2}`,
    );
    await step(
      'lista sin acceso',
      403,
      'get',
      `/devices?branchId=${ids.branchA}`,
      undefined,
      outsiderToken,
    );

    await step('folio obligatorio', 400, 'patch', `/devices/${pc.id}`, {
      ownershipType: 'PROVIDER',
    });
    await step('editar notas', 200, 'patch', `/devices/${pc.id}`, {
      notes: 'editado',
    });
    await step(
      'editar imei en computadora',
      400,
      'patch',
      `/devices/${pc.id}`,
      { imei: '1' },
    );
    await step(
      'editar sin acceso',
      403,
      'patch',
      `/devices/${pc.id}`,
      { notes: 'x' },
      outsiderToken,
    );

    await step(
      'asignar sin destino',
      400,
      'post',
      `/devices/${pc.id}/assign`,
      {},
    );
    await step('asignar a ambos', 400, 'post', `/devices/${pc.id}/assign`, {
      employeeId: ids.employee,
      locationId: ids.location,
    });
    await step('asignar empleado', 201, 'post', `/devices/${pc.id}/assign`, {
      employeeId: ids.employee,
      usageType,
    });
    await step('asignar ocupado', 400, 'post', `/devices/${pc.id}/assign`, {
      locationId: ids.location,
    });

    const monitor = await step(
      'accesorio hereda',
      201,
      'post',
      '/devices',
      device('MON1', monitorCatalog, { mainDeviceId: pc.id }),
    );
    expect(monitor.employeeId).toBe(ids.employee);
    await step(
      'accesorio repetido',
      400,
      'post',
      '/devices',
      device('MON2', monitorCatalog, { mainDeviceId: pc.id }),
    );
    await step(
      'asignar accesorio',
      400,
      'post',
      `/devices/${monitor.id}/assign`,
      { employeeId: ids.employee },
    );
    await step(
      'desenlazar computadora',
      400,
      'post',
      `/devices/${pc.id}/unlink`,
    );
    await step(
      'desenlazar accesorio',
      201,
      'post',
      `/devices/${monitor.id}/unlink`,
    );
    await step(
      'desenlazar dos veces',
      400,
      'post',
      `/devices/${monitor.id}/unlink`,
    );
    await step('reenlazar accesorio', 200, 'patch', `/devices/${monitor.id}`, {
      mainDeviceId: pc.id,
    });

    await step('liberar', 201, 'post', `/devices/${pc.id}/unassign`);
    await step('liberar libre', 400, 'post', `/devices/${pc.id}/unassign`);
    const accessory = await step(
      'accesorio liberado en cascada',
      200,
      'get',
      `/devices/${monitor.id}`,
    );
    expect(accessory.status).toBe('AVAILABLE');
    await step('asignar ubicación', 201, 'post', `/devices/${pc.id}/assign`, {
      locationId: ids.location,
    });
    await step('liberar ubicación', 201, 'post', `/devices/${pc.id}/unassign`);

    await step('dar de baja', 201, 'post', `/devices/${pc.id}/retire`, {
      notes: 'obsoleto',
    });
    const unlinked = await step(
      'accesorio tras baja',
      200,
      'get',
      `/devices/${monitor.id}`,
    );
    expect(unlinked.mainDeviceId).toBeNull();
    await step(
      'historial',
      200,
      'get',
      `/devices/${pc.id}/movement-history?limit=50`,
    );
    await step(
      'historial inexistente',
      404,
      'get',
      `/devices/${ids.branchA}/movement-history`,
    );

    // releaseAllForEmployee is what EmployeesService calls on an employee's exit.
    await prisma.$transaction((tx) =>
      app
        .get(DevicesService)
        .releaseAllForEmployee(tx, ids.employee2, 'Salida'),
    );
    const released = await step(
      'liberado por salida',
      200,
      'get',
      `/devices/${assignedPc.id}`,
    );
    expect(released.status).toBe('AVAILABLE');
    await step(
      'historial por salida',
      200,
      'get',
      `/devices/${assignedPc.id}/movement-history?limit=50`,
    );
  });

  it('traspasos: crear, iniciar, recibir, rechazar y cancelar', async () => {
    const { branchA, branchB, computerCatalog, monitorCatalog } = ids;
    const pc = await step(
      'alta t1',
      201,
      'post',
      '/devices',
      device('T1', computerCatalog),
    );
    const monitor = await step(
      'accesorio t1',
      201,
      'post',
      '/devices',
      device('TM1', monitorCatalog, { mainDeviceId: pc.id }),
    );
    const pc2 = await step(
      'alta t2',
      201,
      'post',
      '/devices',
      device('T2', computerCatalog),
    );
    const pc3 = await step(
      'alta t3',
      201,
      'post',
      '/devices',
      device('T3', computerCatalog),
    );
    const busy = await step(
      'alta ocupada',
      201,
      'post',
      '/devices',
      device('T4', computerCatalog, { locationId: ids.location }),
    );
    const transfer = (
      deviceIds: string[],
      origin = branchA,
      destination = branchB,
    ) => ({
      originBranchId: origin,
      destinationBranchId: destination,
      notes: 'nota',
      items: deviceIds.map((deviceId) => ({ deviceId })),
    });

    await step(
      'misma sucursal',
      400,
      'post',
      '/transfers',
      transfer([pc.id], branchA, branchA),
    );
    await step(
      'origen sin acceso',
      403,
      'post',
      '/transfers',
      transfer([pc.id]),
      outsiderToken,
    );
    await step(
      'equipo inexistente',
      404,
      'post',
      '/transfers',
      transfer([branchA]),
    );
    await step(
      'equipo de otra sucursal',
      400,
      'post',
      '/transfers',
      transfer([pc.id], branchB, branchA),
    );
    await step(
      'equipo no disponible',
      400,
      'post',
      '/transfers',
      transfer([busy.id]),
    );
    await step(
      'accesorio suelto',
      400,
      'post',
      '/transfers',
      transfer([monitor.id]),
    );

    const t1 = await step(
      'crear',
      201,
      'post',
      '/transfers',
      transfer([pc.id]),
    );
    await step('recibir pendiente', 400, 'post', `/transfers/${t1.id}/receive`);
    await step(
      'rechazar pendiente',
      400,
      'post',
      `/transfers/${t1.id}/reject`,
      { reason: 'x' },
    );
    await step('iniciar', 201, 'post', `/transfers/${t1.id}/initiate`);
    await step(
      'iniciar dos veces',
      400,
      'post',
      `/transfers/${t1.id}/initiate`,
    );
    await step(
      'cancelar en tránsito',
      400,
      'post',
      `/transfers/${t1.id}/cancel`,
      { reason: 'x' },
    );
    const inTransit = await step(
      'accesorio en tránsito',
      200,
      'get',
      `/devices/${monitor.id}`,
    );
    expect(inTransit.status).toBe('IN_TRANSFER');
    await step('recibir', 201, 'post', `/transfers/${t1.id}/receive`);
    const received = await step(
      'accesorio recibido',
      200,
      'get',
      `/devices/${monitor.id}`,
    );
    expect(received.currentBranchId).toBe(branchB);
    await step(
      'historial recibido',
      200,
      'get',
      `/devices/${pc.id}/movement-history?limit=50`,
    );

    const t2 = await step(
      'crear t2',
      201,
      'post',
      '/transfers',
      transfer([pc2.id]),
    );
    await step('iniciar t2', 201, 'post', `/transfers/${t2.id}/initiate`);
    await step('rechazar', 201, 'post', `/transfers/${t2.id}/reject`, {
      reason: 'dañado',
    });
    const rejected = await step(
      'equipo rechazado',
      200,
      'get',
      `/devices/${pc2.id}`,
    );
    expect(rejected.status).toBe('AVAILABLE');

    const t3 = await step(
      'crear t3',
      201,
      'post',
      '/transfers',
      transfer([pc3.id]),
    );
    await step(
      'cancelar sin acceso',
      403,
      'post',
      `/transfers/${t3.id}/cancel`,
      { reason: 'x' },
      outsiderToken,
    );
    await step('cancelar', 201, 'post', `/transfers/${t3.id}/cancel`, {
      reason: 'ya no',
    });

    await step(
      'lista traspasos',
      200,
      'get',
      `/transfers?branchId=${branchA}&sort[field]=createdAt&sort[order]=asc`,
    );
    await step(
      'lista por estado',
      200,
      'get',
      `/transfers?branchId=${branchB}&status=COMPLETED`,
    );
    await step('detalle traspaso', 200, 'get', `/transfers/${t1.id}`);
    await step('traspaso inexistente', 404, 'get', `/transfers/${branchA}`);
  });
});
