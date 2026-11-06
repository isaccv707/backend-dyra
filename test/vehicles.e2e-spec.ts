import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { writeFileSync } from 'fs';
import request from 'supertest';
import { SafeguardConditionState, SafeguardUsageType } from '@prisma/client';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { MailService } from 'src/mail/mail.service';
import { MailQueueService } from 'src/mail/mail-queue.service';
import { VehiclesService } from 'src/vehicles/vehicles.service';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { ensureE2eBaseData } from './support/e2e-seed';

/**
 * Vehicles and vehicle transfers end to end against a real database. Creates
 * its own branches, users and catalog and deletes them afterwards. With
 * VEHICLES_E2E_TRACE=<path> it also writes every normalized response to a
 * file, to compare behavior before and after a refactor.
 */
describe('Vehículos y traspasos (e2e)', () => {
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
    catalog: '',
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

  const vehicle = (internalCode: string, extra = {}) => ({
    internalCode: `${internalCode}-${tag}`,
    catalogId: ids.catalog,
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
        data: { name: `Patio ${tag}`, branchId: ids.branchA },
      })
    ).id;
    ids.catalog = (
      await prisma.vehicleCatalog.create({
        data: { name: `Sedán ${tag}`, brand: 'E2E', model: `S-${tag}` },
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
    token = await user('admin', [ids.branchA, ids.branchB]);
    outsiderToken = await user('outsider', [ids.branchB]);
  }, 60_000);

  afterAll(async () => {
    if (process.env.VEHICLES_E2E_TRACE) {
      writeFileSync(
        process.env.VEHICLES_E2E_TRACE,
        JSON.stringify(trace, null, 2),
      );
    }
    if (!prisma) return;
    const branches = [ids.branchA, ids.branchB].filter(Boolean);
    await prisma.vehicleTransferRequest.deleteMany({
      where: { originBranchId: { in: branches } },
    });
    await prisma.vehicleSafeguard.deleteMany({
      where: { branchId: { in: branches } },
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
    await prisma.employee.deleteMany({ where: { branchId: { in: branches } } });
    await prisma.location.deleteMany({ where: { branchId: { in: branches } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: branches } } });
    await prisma.address.deleteMany({ where: { id: { in: ids.addressIds } } });
    await app.close();
  }, 60_000);

  it('alta, validaciones, asignación y baja', async () => {
    await step(
      'alta sin acceso',
      403,
      'post',
      '/vehicles',
      vehicle('X0'),
      outsiderToken,
    );
    await step(
      'empleado y ubicación',
      400,
      'post',
      '/vehicles',
      vehicle('X1', { employeeId: ids.employee, locationId: ids.location }),
    );
    await step(
      'catálogo inexistente',
      404,
      'post',
      '/vehicles',
      vehicle('X2', { catalogId: ids.branchA }),
    );
    await step(
      'empleado ajeno',
      400,
      'post',
      '/vehicles',
      vehicle('X3', { employeeId: ids.foreignEmployee, usageType }),
    );
    await step(
      'empleado de baja',
      400,
      'post',
      '/vehicles',
      vehicle('X4', { employeeId: ids.inactiveEmployee, usageType }),
    );
    await step(
      'ubicación inexistente',
      404,
      'post',
      '/vehicles',
      vehicle('X5', { locationId: ids.branchA }),
    );
    await step(
      'primera responsiva sin usageType',
      400,
      'post',
      '/vehicles',
      vehicle('X6', { employeeId: ids.employee }),
    );

    const car = await step(
      'alta disponible',
      201,
      'post',
      '/vehicles',
      vehicle('V1', { plateNumber: `P1-${tag}` }),
    );
    await step('código duplicado', 409, 'post', '/vehicles', vehicle('V1'));
    const assignedCar = await step(
      'alta asignada',
      201,
      'post',
      '/vehicles',
      vehicle('V2', { employeeId: ids.employee2, usageType }),
    );
    await step(
      'segundo vehículo mismo empleado',
      400,
      'post',
      `/vehicles/${car.id}/assign`,
      { employeeId: ids.employee2 },
    );

    await step('detalle', 200, 'get', `/vehicles/${car.id}`);
    await step('detalle inexistente', 404, 'get', `/vehicles/${ids.branchA}`);
    await step(
      'lista filtrada',
      200,
      'get',
      `/vehicles?branchId=${ids.branchA}&employeeId=${ids.employee2}`,
    );
    await step(
      'lista sin acceso',
      403,
      'get',
      `/vehicles?branchId=${ids.branchA}`,
      undefined,
      outsiderToken,
    );

    await step('folio obligatorio', 400, 'patch', `/vehicles/${car.id}`, {
      ownershipType: 'PROVIDER',
    });
    await step('editar notas', 200, 'patch', `/vehicles/${car.id}`, {
      notes: 'editado',
      mileage: '1000',
    });
    await step(
      'editar sin acceso',
      403,
      'patch',
      `/vehicles/${car.id}`,
      { notes: 'x' },
      outsiderToken,
    );
    await step('editar inexistente', 404, 'patch', `/vehicles/${ids.branchA}`, {
      notes: 'x',
    });

    await step(
      'asignar sin destino',
      400,
      'post',
      `/vehicles/${car.id}/assign`,
      {},
    );
    await step('asignar a ambos', 400, 'post', `/vehicles/${car.id}/assign`, {
      employeeId: ids.employee,
      locationId: ids.location,
    });
    await step('asignar empleado', 201, 'post', `/vehicles/${car.id}/assign`, {
      employeeId: ids.employee,
      usageType,
    });
    await step('asignar ocupado', 400, 'post', `/vehicles/${car.id}/assign`, {
      locationId: ids.location,
    });
    await step('liberar', 201, 'post', `/vehicles/${car.id}/unassign`);
    await step('liberar libre', 400, 'post', `/vehicles/${car.id}/unassign`);
    await step(
      'reasignar con responsiva previa',
      201,
      'post',
      `/vehicles/${car.id}/assign`,
      { employeeId: ids.employee },
    );
    await step('liberar otra vez', 201, 'post', `/vehicles/${car.id}/unassign`);
    await step('asignar ubicación', 201, 'post', `/vehicles/${car.id}/assign`, {
      locationId: ids.location,
    });
    await step(
      'liberar sin acceso',
      403,
      'post',
      `/vehicles/${car.id}/unassign`,
      undefined,
      outsiderToken,
    );
    await step(
      'liberar ubicación',
      201,
      'post',
      `/vehicles/${car.id}/unassign`,
    );

    await step('dar de baja', 201, 'post', `/vehicles/${car.id}/retire`, {
      notes: 'siniestro',
    });
    await step(
      'asignar dado de baja',
      400,
      'post',
      `/vehicles/${car.id}/assign`,
      { locationId: ids.location },
    );
    await step(
      'historial',
      200,
      'get',
      `/vehicles/${car.id}/movement-history?limit=50`,
    );
    await step(
      'historial inexistente',
      404,
      'get',
      `/vehicles/${ids.branchA}/movement-history`,
    );

    // releaseAllForEmployee is what EmployeesService calls on an employee's exit.
    await prisma.$transaction((tx) =>
      app
        .get(VehiclesService)
        .releaseAllForEmployee(tx, ids.employee2, 'Salida'),
    );
    const released = await step(
      'liberado por salida',
      200,
      'get',
      `/vehicles/${assignedCar.id}`,
    );
    expect(released.status).toBe('AVAILABLE');
    await step(
      'historial por salida',
      200,
      'get',
      `/vehicles/${assignedCar.id}/movement-history?limit=50`,
    );
  });

  it('traspasos: crear, iniciar, recibir, rechazar y cancelar', async () => {
    const { branchA, branchB } = ids;
    const v1 = await step('alta t1', 201, 'post', '/vehicles', vehicle('T1'));
    const v2 = await step('alta t2', 201, 'post', '/vehicles', vehicle('T2'));
    const v3 = await step('alta t3', 201, 'post', '/vehicles', vehicle('T3'));
    const busy = await step(
      'alta ocupada',
      201,
      'post',
      '/vehicles',
      vehicle('T4', { locationId: ids.location }),
    );
    const transfer = (
      vehicleIds: string[],
      origin = branchA,
      destination = branchB,
    ) => ({
      originBranchId: origin,
      destinationBranchId: destination,
      notes: 'nota',
      items: vehicleIds.map((vehicleId) => ({ vehicleId })),
    });

    await step(
      'misma sucursal',
      400,
      'post',
      '/vehicle-transfers',
      transfer([v1.id], branchA, branchA),
    );
    await step(
      'origen sin acceso',
      403,
      'post',
      '/vehicle-transfers',
      transfer([v1.id]),
      outsiderToken,
    );
    await step(
      'vehículo inexistente',
      404,
      'post',
      '/vehicle-transfers',
      transfer([branchA]),
    );
    await step(
      'vehículo de otra sucursal',
      400,
      'post',
      '/vehicle-transfers',
      transfer([v1.id], branchB, branchA),
    );
    await step(
      'vehículo no disponible',
      400,
      'post',
      '/vehicle-transfers',
      transfer([busy.id]),
    );

    const t1 = await step(
      'crear',
      201,
      'post',
      '/vehicle-transfers',
      transfer([v1.id]),
    );
    await step(
      'recibir pendiente',
      400,
      'post',
      `/vehicle-transfers/${t1.id}/receive`,
    );
    await step(
      'rechazar pendiente',
      400,
      'post',
      `/vehicle-transfers/${t1.id}/reject`,
      { reason: 'x' },
    );
    await step('iniciar', 201, 'post', `/vehicle-transfers/${t1.id}/initiate`);
    await step(
      'iniciar dos veces',
      400,
      'post',
      `/vehicle-transfers/${t1.id}/initiate`,
    );
    await step(
      'cancelar en tránsito',
      400,
      'post',
      `/vehicle-transfers/${t1.id}/cancel`,
      { reason: 'x' },
    );
    const inTransit = await step(
      'vehículo en tránsito',
      200,
      'get',
      `/vehicles/${v1.id}`,
    );
    expect(inTransit.status).toBe('IN_TRANSFER');
    await step('recibir', 201, 'post', `/vehicle-transfers/${t1.id}/receive`);
    const received = await step(
      'vehículo recibido',
      200,
      'get',
      `/vehicles/${v1.id}`,
    );
    expect(received.currentBranchId).toBe(branchB);
    await step(
      'historial recibido',
      200,
      'get',
      `/vehicles/${v1.id}/movement-history?limit=50`,
    );

    const t2 = await step(
      'crear t2',
      201,
      'post',
      '/vehicle-transfers',
      transfer([v2.id]),
    );
    await step(
      'iniciar t2',
      201,
      'post',
      `/vehicle-transfers/${t2.id}/initiate`,
    );
    await step('rechazar', 201, 'post', `/vehicle-transfers/${t2.id}/reject`, {
      reason: 'dañado',
    });
    const rejected = await step(
      'vehículo rechazado',
      200,
      'get',
      `/vehicles/${v2.id}`,
    );
    expect(rejected.status).toBe('AVAILABLE');

    const t3 = await step(
      'crear t3',
      201,
      'post',
      '/vehicle-transfers',
      transfer([v3.id]),
    );
    await step(
      'cancelar sin acceso',
      403,
      'post',
      `/vehicle-transfers/${t3.id}/cancel`,
      { reason: 'x' },
      outsiderToken,
    );
    await step('cancelar', 201, 'post', `/vehicle-transfers/${t3.id}/cancel`, {
      reason: 'ya no',
    });

    await step(
      'lista traspasos',
      200,
      'get',
      `/vehicle-transfers?branchId=${branchA}&sort[field]=createdAt&sort[order]=asc`,
    );
    await step(
      'lista por estado',
      200,
      'get',
      `/vehicle-transfers?branchId=${branchB}&status=COMPLETED`,
    );
    await step('detalle traspaso', 200, 'get', `/vehicle-transfers/${t1.id}`);
    await step(
      'traspaso inexistente',
      404,
      'get',
      `/vehicle-transfers/${branchA}`,
    );
  });
});
