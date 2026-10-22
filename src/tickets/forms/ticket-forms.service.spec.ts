import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { MailService } from 'src/mail/mail.service';
import { StudiesService } from 'src/studies/studies.service';
import { UsersService } from 'src/users/users.service';
import { AccessRequestFormHandler } from './handlers/access-request-form.handler';
import { ClientCreateFormHandler } from './handlers/client-create-form.handler';
import { SoftwareRemoteFormHandler } from './handlers/software-remote-form.handler';
import { StudyCreateFormHandler } from './handlers/study-create-form.handler';
import { StudyUpdateFormHandler } from './handlers/study-update-form.handler';
import { TicketFormsService } from './ticket-forms.service';

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const SERVICE_ID = '22222222-2222-4222-8222-222222222222';
const SHEET_ID = '33333333-3333-4333-8333-333333333333';
const STUDY_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_ID = '55555555-5555-4555-8555-555555555555';
const ROLE_ID = '66666666-6666-4666-8666-666666666666';

describe('TicketFormsService', () => {
  let service: TicketFormsService;
  let prisma: {
    role: { findUnique: jest.Mock };
    branch: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    priceSheets: { findFirst: jest.Mock };
    study: { findUniqueOrThrow: jest.Mock };
  };
  let studies: Record<
    | 'assertCreatable'
    | 'assertCreatableMany'
    | 'createMany'
    | 'assertUpdatable'
    | 'assertValidPanelChildren'
    | 'assertPriceSheetsBelongToBranch'
    | 'create'
    | 'update'
    | 'setPanelItems'
    | 'replacePrices',
    jest.Mock
  >;
  let users: { create: jest.Mock };
  let mail: { sendAccessGrantedEmail: jest.Mock };

  const actor: RequestUser = {
    id: 'user-1',
    email: 'ti@dyra.com',
    name: 'TI',
    isActive: true,
    branches: [{ id: BRANCH_ID, name: 'Sucursal 1' }],
    role: { id: 'role-1', name: 'Administrador', permissions: [] },
  };
  const context = { branchId: BRANCH_ID, actor, phase: 'request' as const };
  const tx = {} as never;

  const studyForm = {
    name: 'Glucosa',
    serviceId: SERVICE_ID,
    sectionId: 1,
    sampleTypeId: 2,
    units: 'mg/dL',
    decimals: 1,
    studyPrices: [{ priceSheetId: SHEET_ID, price: 120 }],
  };
  const panelForm = {
    name: 'Química sanguínea',
    serviceId: SERVICE_ID,
    sectionId: 1,
    sampleTypeId: 2,
    isPanel: true,
    panelItems: [
      { studyId: CHILD_ID },
      {
        newStudy: {
          name: 'Urea',
          serviceId: SERVICE_ID,
          sectionId: 1,
          sampleTypeId: 2,
        },
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      role: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ name: 'Usuario', permissions: [] }),
      },
      branch: { findUnique: jest.fn().mockResolvedValue({ id: BRANCH_ID }) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      priceSheets: { findFirst: jest.fn() },
      study: { findUniqueOrThrow: jest.fn() },
    };
    studies = {
      assertCreatable: jest.fn().mockResolvedValue(undefined),
      assertCreatableMany: jest.fn().mockResolvedValue(undefined),
      createMany: jest.fn().mockResolvedValue([]),
      assertUpdatable: jest.fn(),
      assertValidPanelChildren: jest.fn().mockResolvedValue(undefined),
      assertPriceSheetsBelongToBranch: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      update: jest.fn(),
      setPanelItems: jest.fn().mockResolvedValue([]),
      replacePrices: jest.fn().mockResolvedValue(undefined),
    };
    users = { create: jest.fn().mockResolvedValue({ id: 'new-user' }) };
    mail = { sendAccessGrantedEmail: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        TicketFormsService,
        SoftwareRemoteFormHandler,
        AccessRequestFormHandler,
        StudyCreateFormHandler,
        StudyUpdateFormHandler,
        ClientCreateFormHandler,
        { provide: PrismaService, useValue: prisma },
        { provide: StudiesService, useValue: studies },
        { provide: UsersService, useValue: users },
        { provide: MailService, useValue: mail },
      ],
    }).compile();

    service = module.get(TicketFormsService);
  });

  describe('parse', () => {
    it('rechaza campos que el formulario no declara', async () => {
      await expect(
        service.parse(
          'SOFTWARE_REMOTE',
          { teamViewerId: '123', password: 'x' },
          context,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('SOFTWARE_REMOTE no genera título (lo escribe el usuario)', async () => {
      const parsed = await service.parse(
        'SOFTWARE_REMOTE',
        { teamViewerId: '123 456 789' },
        context,
      );
      expect(parsed).toEqual({
        data: { teamViewerId: '123 456 789' },
        title: undefined,
      });
    });

    it('STUDY_CREATE valida con las reglas de estudios y genera el título', async () => {
      const parsed = await service.parse('STUDY_CREATE', studyForm, context);

      expect(studies.assertCreatable).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Glucosa', branchId: BRANCH_ID }),
        prisma,
      );
      expect(parsed.title).toBe('Alta de parámetro: Glucosa');
      expect(parsed.data).toMatchObject({ name: 'Glucosa', units: 'mg/dL' });
    });

    it('STUDY_CREATE no acepta el code (lo asigna TI al aprobar)', async () => {
      await expect(
        service.parse('STUDY_CREATE', { ...studyForm, code: 'GLU' }, context),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('un perfil debe traer al menos un hijo', async () => {
      await expect(
        service.parse(
          'STUDY_CREATE',
          { ...panelForm, panelItems: [] },
          context,
        ),
      ).rejects.toThrow('al menos un estudio');
    });

    it('cada hijo es un estudio existente o uno nuevo, no ambos', async () => {
      await expect(
        service.parse(
          'STUDY_CREATE',
          {
            ...panelForm,
            panelItems: [
              { studyId: CHILD_ID, newStudy: panelForm.panelItems[1].newStudy },
            ],
          },
          context,
        ),
      ).rejects.toThrow('solo uno');
    });

    it('valida hijos existentes y nuevos del perfil', async () => {
      const parsed = await service.parse('STUDY_CREATE', panelForm, context);

      expect(studies.assertValidPanelChildren).toHaveBeenCalledWith(
        null,
        BRANCH_ID,
        [CHILD_ID],
        prisma,
      );
      // Los parámetros nuevos se validan juntos (consultas en lote).
      expect(studies.assertCreatableMany).toHaveBeenCalledWith(
        [
          {
            label: 'form.panelItems[1].newStudy',
            dto: expect.objectContaining({ name: 'Urea', isPanel: false }),
          },
        ],
        BRANCH_ID,
        prisma,
      );
      expect(parsed.title).toBe('Alta de perfil: Química sanguínea');
    });

    it('STUDY_UPDATE exige al menos un cambio', async () => {
      await expect(
        service.parse('STUDY_UPDATE', { studyId: STUDY_ID }, context),
      ).rejects.toThrow('al menos un dato');
    });

    it('STUDY_UPDATE no permite limpiar la sección, sí la técnica', async () => {
      await expect(
        service.parse(
          'STUDY_UPDATE',
          { studyId: STUDY_ID, sectionId: null },
          context,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(studies.assertUpdatable).not.toHaveBeenCalled();

      studies.assertUpdatable.mockResolvedValue({
        id: STUDY_ID,
        branchId: BRANCH_ID,
        isPanel: false,
        code: 'GLU',
        name: 'Glucosa',
      });
      const parsed = await service.parse(
        'STUDY_UPDATE',
        { studyId: STUDY_ID, techniqueId: null },
        context,
      );
      expect(parsed.title).toBe('Actualización de parámetro: GLU Glucosa');
      expect(parsed.data).toEqual({ studyId: STUDY_ID, techniqueId: null });
    });

    it('STUDY_UPDATE rechaza un estudio de otra sucursal', async () => {
      studies.assertUpdatable.mockResolvedValue({
        id: STUDY_ID,
        branchId: 'other-branch',
        isPanel: false,
        code: 'GLU',
        name: 'Glucosa',
      });

      await expect(
        service.parse(
          'STUDY_UPDATE',
          { studyId: STUDY_ID, units: 'g/L' },
          context,
        ),
      ).rejects.toThrow('otra sucursal');
    });

    const accessForm = {
      fullName: 'Ana López',
      email: 'Ana@Dyra.com',
      roleId: ROLE_ID,
      branchId: BRANCH_ID,
    };

    it('ACCESS_REQUEST no revela al solicitante si el correo ya tiene cuenta', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      const parsed = await service.parse('ACCESS_REQUEST', accessForm, context);

      expect(parsed.title).toBe('Acceso: Ana López');
      expect(parsed.data).toMatchObject({ email: 'ana@dyra.com' });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('ACCESS_REQUEST no acepta roles que administran usuarios, roles o permisos', async () => {
      prisma.role.findUnique.mockResolvedValue({
        name: 'Administrador',
        permissions: [{ action: 'users:create' }, { action: 'tickets:create' }],
      });

      await expect(
        service.parse('ACCESS_REQUEST', accessForm, context),
      ).rejects.toMatchObject({
        response: {
          message: [expect.stringContaining('solo lo asigna un administrador')],
        },
      });
    });

    it('ACCESS_REQUEST responde 400 (no 404) si el rol no existe', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(
        service.parse('ACCESS_REQUEST', accessForm, context),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('los mensajes de validación por defecto salen en español con la ruta completa', async () => {
      await expect(
        service.parse('STUDY_CREATE', { ...studyForm, name: '' }, context),
      ).rejects.toMatchObject({
        response: {
          message: expect.arrayContaining(['form.name no puede estar vacío']),
        },
      });
      await expect(
        service.parse('SOFTWARE_REMOTE', { teamViewerId: '1', x: 1 }, context),
      ).rejects.toMatchObject({
        response: { message: ['form.x no es un campo permitido'] },
      });
    });

    it('STUDY_UPDATE guarda la versión base de las listas que reemplaza', async () => {
      studies.assertUpdatable.mockResolvedValue({
        id: STUDY_ID,
        branchId: BRANCH_ID,
        isPanel: false,
        code: 'GLU',
        name: 'Glucosa',
      });
      prisma.study.findUniqueOrThrow.mockResolvedValue({
        priceSheets: [
          { priceSheetId: SHEET_ID, price: '100', showPrice: true },
        ],
        referenceValues: [],
        panelItems: [],
      });

      const parsed = await service.parse(
        'STUDY_UPDATE',
        {
          studyId: STUDY_ID,
          studyPrices: [{ priceSheetId: SHEET_ID, price: 150 }],
          // Lo que mande el cliente se reemplaza.
          baseVersions: { studyPrices: 'forged' },
        },
        context,
      );

      const base = parsed.data.baseVersions as Record<string, string>;
      expect(Object.keys(base)).toEqual(['studyPrices']);
      expect(base.studyPrices).toMatch(/^[0-9a-f]{16}$/);
    });

    it('CLIENT_CREATE exige un tarifario activo de la sucursal', async () => {
      prisma.priceSheets.findFirst.mockResolvedValue(null);

      await expect(
        service.parse(
          'CLIENT_CREATE',
          {
            name: 'Clínica Sur',
            email: 'compras@clinicasur.mx',
            receivable: true,
            payInCash: false,
            priceSheetId: SHEET_ID,
          },
          context,
        ),
      ).rejects.toThrow('form.priceSheetId');
      expect(prisma.priceSheets.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SHEET_ID, branchId: BRANCH_ID, isActive: true },
        }),
      );
    });
  });

  describe('apply', () => {
    // Al aprobar, quien actúa es TI.
    const context = { branchId: BRANCH_ID, actor, phase: 'apply' as const };
    it('los formularios informativos no tienen acción', async () => {
      await expect(
        service.apply(
          'SOFTWARE_REMOTE',
          { teamViewerId: '1' },
          {},
          context,
          tx,
        ),
      ).rejects.toThrow('informativo');
    });

    it('STUDY_CREATE crea el perfil, sus parámetros nuevos y los enlaza en orden', async () => {
      studies.createMany.mockResolvedValue([
        { id: 'urea-id', code: 'UREA', name: 'Urea' },
      ]);
      studies.create.mockResolvedValue({
        id: 'panel-id',
        code: 'QS',
        name: 'Química sanguínea',
      });

      const applied = await service.apply(
        'STUDY_CREATE',
        panelForm,
        { code: 'qs', newStudies: [{ code: 'urea' }] },
        context,
        tx,
      );

      expect(studies.createMany).toHaveBeenCalledWith(
        [
          {
            label: 'form.panelItems[1].newStudy',
            dto: expect.objectContaining({
              name: 'Urea',
              code: 'UREA',
              isPanel: false,
              branchId: BRANCH_ID,
            }),
          },
        ],
        actor,
        tx,
      );
      expect(studies.create).toHaveBeenCalledTimes(1);
      expect(studies.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Química sanguínea',
          code: 'QS',
          isPanel: true,
        }),
        actor,
        tx,
      );
      expect(studies.create.mock.calls[0][0]).not.toHaveProperty('panelItems');
      expect(studies.setPanelItems).toHaveBeenCalledWith(
        'panel-id',
        { items: [{ childId: CHILD_ID }, { childId: 'urea-id' }] },
        actor,
        tx,
      );
      expect(applied.result).toMatchObject({
        studyId: 'panel-id',
        createdChildren: [{ id: 'urea-id', code: 'UREA' }],
      });
    });

    it('STUDY_CREATE exige un code por cada parámetro nuevo', async () => {
      await expect(
        service.apply('STUDY_CREATE', panelForm, { code: 'QS' }, context, tx),
      ).rejects.toThrow('newStudies debe traer 1');
      expect(studies.create).not.toHaveBeenCalled();
      expect(studies.createMany).not.toHaveBeenCalled();
    });

    it('STUDY_CREATE propaga el error si falla un paso (la transacción revierte)', async () => {
      studies.create.mockRejectedValue(new ConflictException('code duplicado'));

      await expect(
        service.apply('STUDY_CREATE', studyForm, { code: 'GLU' }, context, tx),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('STUDY_UPDATE quita los hijos antes de desmarcar el perfil y guarda el antes/después', async () => {
      const current = {
        id: STUDY_ID,
        branchId: BRANCH_ID,
        isPanel: true,
        code: 'QS',
        name: 'Química',
      };
      studies.assertUpdatable.mockResolvedValue(current);
      prisma.study.findUniqueOrThrow.mockResolvedValue({
        ...current,
        units: null,
        priceSheets: [
          { priceSheetId: SHEET_ID, price: '100', showPrice: true },
        ],
        referenceValues: [],
        panelItems: [{ childId: CHILD_ID }],
      });
      studies.update.mockResolvedValue({ ...current, isPanel: false });
      const txWithStudy = prisma as never;

      const applied = await service.apply(
        'STUDY_UPDATE',
        {
          studyId: STUDY_ID,
          isPanel: false,
          units: 'mg/dL',
          panelItems: [],
          studyPrices: [{ priceSheetId: SHEET_ID, price: 150 }],
        },
        {},
        context,
        txWithStudy,
      );

      expect(studies.assertUpdatable).toHaveBeenCalledWith(
        STUDY_ID,
        { isPanel: false, units: 'mg/dL' },
        actor,
        txWithStudy,
        { childrenWillBeRemoved: true },
      );
      const clearOrder = studies.setPanelItems.mock.invocationCallOrder[0];
      const updateOrder = studies.update.mock.invocationCallOrder[0];
      expect(clearOrder).toBeLessThan(updateOrder);
      expect(studies.setPanelItems).toHaveBeenCalledWith(
        STUDY_ID,
        { items: [] },
        actor,
        txWithStudy,
      );
      expect(studies.replacePrices).toHaveBeenCalledWith(
        STUDY_ID,
        [expect.objectContaining({ priceSheetId: SHEET_ID, price: 150 })],
        actor,
        txWithStudy,
      );
      expect(applied.result).toMatchObject({
        before: { isPanel: true, units: null, panelItems: [CHILD_ID] },
        after: { isPanel: false, units: 'mg/dL', panelItems: [] },
      });
    });

    const storedAccess = {
      fullName: 'Ana López',
      email: 'ana@dyra.com',
      roleId: ROLE_ID,
      branchId: BRANCH_ID,
    };

    it('STUDY_UPDATE responde 409 si la lista cambió desde la solicitud', async () => {
      studies.assertUpdatable.mockResolvedValue({
        id: STUDY_ID,
        branchId: BRANCH_ID,
        isPanel: false,
        code: 'GLU',
        name: 'Glucosa',
      });
      prisma.study.findUniqueOrThrow.mockResolvedValue({
        priceSheets: [
          { priceSheetId: SHEET_ID, price: '120', showPrice: true },
        ],
        referenceValues: [],
        panelItems: [],
      });

      await expect(
        service.apply(
          'STUDY_UPDATE',
          {
            studyId: STUDY_ID,
            studyPrices: [{ priceSheetId: SHEET_ID, price: 150 }],
            baseVersions: { studyPrices: '0000000000000000' },
          },
          {},
          context,
          prisma as never,
        ),
      ).rejects.toThrow('El estudio cambió desde la solicitud (los precios)');
      expect(studies.replacePrices).not.toHaveBeenCalled();
    });

    it('ACCESS_REQUEST revisa el correo hasta aprobar (409 si ya existe)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.apply(
          'ACCESS_REQUEST',
          storedAccess,
          {},
          context,
          prisma as never,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.create).not.toHaveBeenCalled();
    });

    it('ACCESS_REQUEST no deja asignar un rol con permisos que el aprobador no tiene', async () => {
      prisma.role.findUnique.mockResolvedValue({
        name: 'Soporte TI',
        permissions: [{ action: 'tickets:update' }],
      });

      await expect(
        service.apply(
          'ACCESS_REQUEST',
          storedAccess,
          {},
          context,
          prisma as never,
        ),
      ).rejects.toThrow('tickets:update');
      expect(users.create).not.toHaveBeenCalled();
    });

    it('ACCESS_REQUEST crea el usuario en la sucursal y avisa por correo tras confirmar', async () => {
      const applied = await service.apply(
        'ACCESS_REQUEST',
        {
          fullName: 'Ana López',
          email: 'ana@dyra.com',
          roleId: ROLE_ID,
          branchId: BRANCH_ID,
        },
        {},
        context,
        prisma as never,
      );

      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'ana@dyra.com',
          name: 'Ana López',
          roleId: ROLE_ID,
          branchIds: [BRANCH_ID],
          password: expect.any(String),
        }),
        prisma,
      );
      expect(applied.result).toMatchObject({ emailSent: null });
      expect(mail.sendAccessGrantedEmail).not.toHaveBeenCalled();
      await expect(applied.afterCommit?.()).resolves.toEqual({
        emailSent: true,
      });
      expect(mail.sendAccessGrantedEmail).toHaveBeenCalledWith(
        'ana@dyra.com',
        'Ana López',
      );

      mail.sendAccessGrantedEmail.mockRejectedValueOnce(new Error('smtp'));
      await expect(applied.afterCommit?.()).resolves.toEqual({
        emailSent: false,
      });
    });
  });
});
