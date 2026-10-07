import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { StudiesService } from 'src/studies/studies.service';
import { StudyCreateFormHandler } from './study-create/study-create-form.handler';
import { StudyUpdateFormHandler } from './study-update/study-update-form.handler';
import { TicketFormsService } from './ticket-forms.service';

describe('TicketFormsService', () => {
  let service: TicketFormsService;
  let prisma: {
    priceSheets: { findMany: jest.Mock };
    study: { findUnique: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    studyOnPriceSheet: { findMany: jest.Mock; upsert: jest.Mock };
    $transaction: jest.Mock;
  };
  let studiesService: {
    assertValidAgeRange: jest.Mock;
    assertCatalogsBelongToBranch: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    setPanelItems: jest.Mock;
    remove: jest.Mock;
  };

  const branchId = 'branch-1';
  const sheetA = '11111111-1111-4111-8111-111111111111';
  const sheetB = '22222222-2222-4222-8222-222222222222';

  const validForm = () => ({
    name: 'Glucosa',
    sectionId: 1,
    sampleTypeId: 2,
    techniqueId: 3,
    isPanel: false,
    gender: 'A',
    ageFormat: 'AÑOS',
    minAge: 0,
    maxAge: 120,
    decimals: 2,
    units: 'mg/dL',
    prices: [
      { priceSheetId: sheetA, price: 150 },
      { priceSheetId: sheetB, price: 120.5 },
    ],
  });

  const messagesOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as {
      message: string | string[];
    };
  };

  beforeEach(async () => {
    prisma = {
      priceSheets: {
        findMany: jest.fn().mockResolvedValue([
          { id: sheetA, name: 'General' },
          { id: sheetB, name: 'Convenio' },
        ]),
      },
      study: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
      },
      studyOnPriceSheet: {
        findMany: jest.fn(),
        upsert: jest.fn().mockReturnValue('upsert-op'),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    studiesService = {
      assertValidAgeRange: jest.fn(),
      assertCatalogsBelongToBranch: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      setPanelItems: jest.fn(),
      remove: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        TicketFormsService,
        StudyCreateFormHandler,
        StudyUpdateFormHandler,
        { provide: PrismaService, useValue: prisma },
        { provide: StudiesService, useValue: studiesService },
      ],
    }).compile();

    service = module.get(TicketFormsService);
  });

  describe('parseData', () => {
    it('acepta un formulario válido y valida catálogos y edades en la sucursal', async () => {
      const data = await service.parseData('STUDY_CREATE', validForm(), {
        branchId,
      });

      expect(data).toEqual(validForm());
      expect(studiesService.assertCatalogsBelongToBranch).toHaveBeenCalledWith(
        { sectionId: 1, sampleTypeId: 2, techniqueId: 3 },
        branchId,
      );
      expect(studiesService.assertValidAgeRange).toHaveBeenCalledWith(0, 120);
      expect(prisma.priceSheets.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { branchId, isActive: true } }),
      );
    });

    it('rechaza campos desconocidos y prefija la ruta del error', async () => {
      const { message } = await messagesOf(
        service.parseData(
          'STUDY_CREATE',
          { ...validForm(), code: 'GLU' },
          { branchId },
          'form',
        ),
      );

      expect(message).toEqual(['form.property code should not exist']);
    });

    it('reporta errores de precios anidados con su índice', async () => {
      const form = validForm();
      form.prices[1].price = -1;

      const { message } = await messagesOf(
        service.parseData('STUDY_CREATE', form, { branchId }, 'form'),
      );

      expect(message).toEqual(['form.prices.1.price must not be less than 0']);
    });

    it('exige decimals cuando no es perfil', async () => {
      const { decimals: _omit, ...form } = validForm();

      const { message } = await messagesOf(
        service.parseData('STUDY_CREATE', form, { branchId }),
      );

      expect(message).toEqual(
        expect.arrayContaining(['decimals must be an integer number']),
      );
    });

    it('no pide decimals en un perfil y lo rechaza si viene', async () => {
      const { decimals: _omit, ...panel } = { ...validForm(), isPanel: true };
      await expect(
        service.parseData('STUDY_CREATE', panel, { branchId }),
      ).resolves.toBeDefined();

      await expect(
        service.parseData(
          'STUDY_CREATE',
          { ...validForm(), isPanel: true },
          { branchId },
        ),
      ).rejects.toThrow('decimals no aplica a un perfil (isPanel = true)');
    });

    it('exige precio para todos los tarifarios activos de la sucursal', async () => {
      const form = validForm();
      form.prices = [form.prices[0]];

      await expect(
        service.parseData('STUDY_CREATE', form, { branchId }),
      ).rejects.toThrow('Falta el precio para los tarifarios: Convenio');
    });

    it('rechaza tarifarios inactivos o de otra sucursal', async () => {
      const form = validForm();
      form.prices.push({
        priceSheetId: '33333333-3333-4333-8333-333333333333',
        price: 10,
      });

      await expect(
        service.parseData('STUDY_CREATE', form, { branchId }),
      ).rejects.toThrow(
        'Todos los precios deben ser de tarifarios activos de la sucursal del ticket',
      );
    });

    it('rechaza tarifarios repetidos', async () => {
      const form = validForm();
      form.prices[1].priceSheetId = sheetA;

      await expect(
        service.parseData('STUDY_CREATE', form, { branchId }),
      ).rejects.toThrow('Hay tarifarios repetidos en la lista de precios');
    });
  });

  describe('apply', () => {
    const applyData = {
      code: 'GLU',
      serviceId: '44444444-4444-4444-8444-444444444444',
      abbreviation: 'GLU',
    };

    it('crea el Study en la sucursal del ticket con los datos del formulario y de TI', async () => {
      studiesService.create.mockResolvedValue({
        id: 'study-1',
        code: 'GLU',
        name: 'Glucosa',
      });

      const result = await service.apply(
        'STUDY_CREATE',
        validForm(),
        applyData,
        {
          branchId,
        },
      );

      expect(studiesService.create).toHaveBeenCalledWith({
        name: 'Glucosa',
        sectionId: 1,
        sampleTypeId: 2,
        techniqueId: 3,
        isPanel: false,
        gender: 'A',
        ageFormat: 'AÑOS',
        minAge: 0,
        maxAge: 120,
        decimals: 2,
        units: 'mg/dL',
        ...applyData,
        branchId,
        studyPrices: [
          { priceSheetId: sheetA, price: 150, showPrice: true },
          { priceSheetId: sheetB, price: 120.5, showPrice: true },
        ],
      });
      expect(result).toEqual({
        result: { studyId: 'study-1', code: 'GLU', name: 'Glucosa' },
        summary: 'creó el parámetro GLU - Glucosa',
      });
    });

    it('revalida los tarifarios al aprobar (p. ej. se agregó uno nuevo)', async () => {
      prisma.priceSheets.findMany.mockResolvedValue([
        { id: sheetA, name: 'General' },
        { id: sheetB, name: 'Convenio' },
        { id: 'sheet-c', name: 'Nuevo' },
      ]);

      await expect(
        service.apply('STUDY_CREATE', validForm(), applyData, { branchId }),
      ).rejects.toThrow('Falta el precio para los tarifarios: Nuevo');
      expect(studiesService.create).not.toHaveBeenCalled();
    });

    it('exige code y serviceId de TI', async () => {
      const { message } = await messagesOf(
        service.apply('STUDY_CREATE', validForm(), {}, { branchId }),
      );

      expect(message).toEqual(
        expect.arrayContaining([
          'code should not be empty',
          'serviceId must be a UUID',
        ]),
      );
    });

    it('no permite que TI agregue campos fuera del DTO de aprobación', async () => {
      const { message } = await messagesOf(
        service.apply(
          'STUDY_CREATE',
          validForm(),
          { ...applyData, branchId: 'otra' },
          { branchId },
        ),
      );

      expect(message).toEqual(['property branchId should not exist']);
    });
  });

  describe('STUDY_UPDATE', () => {
    const studyId = '55555555-5555-4555-8555-555555555555';
    const currentStudy = () => ({
      id: studyId,
      branchId,
      code: 'GLU',
      name: 'Glucosa',
      sectionId: 1,
      sampleTypeId: 2,
      techniqueId: 3,
      isPanel: false,
      gender: 'A',
      ageFormat: 'AÑOS',
      minAge: 0,
      maxAge: 120,
      decimals: 2,
      units: 'mg/dL',
      title: null,
      abbreviation: 'GLU',
    });

    beforeEach(() => {
      prisma.study.findUnique.mockResolvedValue(currentStudy());
      prisma.studyOnPriceSheet.findMany.mockResolvedValue([
        { priceSheetId: sheetA, price: new Prisma.Decimal(150) },
      ]);
    });

    it('acepta solo los campos a cambiar', async () => {
      const data = await service.parseData(
        'STUDY_UPDATE',
        { studyId, units: 'mmol/L' },
        { branchId },
      );

      expect(data).toEqual({ studyId, units: 'mmol/L' });
      expect(prisma.priceSheets.findMany).not.toHaveBeenCalled();
    });

    it('acepta solo precios, por tarifario y sin exigir todos', async () => {
      prisma.priceSheets.findMany.mockResolvedValue([
        { id: sheetA, name: 'General' },
      ]);

      await expect(
        service.parseData(
          'STUDY_UPDATE',
          { studyId, prices: [{ priceSheetId: sheetA, price: 180 }] },
          { branchId },
        ),
      ).resolves.toBeDefined();
      expect(prisma.priceSheets.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [sheetA] }, branchId, isActive: true },
        }),
      );
    });

    it('rechaza precios de tarifarios inactivos o de otra sucursal', async () => {
      prisma.priceSheets.findMany.mockResolvedValue([]);

      await expect(
        service.parseData(
          'STUDY_UPDATE',
          { studyId, prices: [{ priceSheetId: sheetA, price: 180 }] },
          { branchId },
        ),
      ).rejects.toThrow(
        'Todos los precios deben ser de tarifarios activos de la sucursal del ticket',
      );
    });

    it('rechaza un parámetro de otra sucursal', async () => {
      prisma.study.findUnique.mockResolvedValue({
        ...currentStudy(),
        branchId: 'branch-2',
      });

      await expect(
        service.parseData(
          'STUDY_UPDATE',
          { studyId, units: 'x' },
          { branchId },
        ),
      ).rejects.toThrow(
        'El parámetro pertenece a otra sucursal distinta a la del ticket',
      );
    });

    it('rechaza la solicitud si no cambia ningún valor ni precio', async () => {
      prisma.priceSheets.findMany.mockResolvedValue([
        { id: sheetA, name: 'General' },
      ]);

      await expect(
        service.parseData(
          'STUDY_UPDATE',
          {
            studyId,
            units: 'mg/dL',
            name: 'Glucosa',
            prices: [{ priceSheetId: sheetA, price: 150 }],
          },
          { branchId },
        ),
      ).rejects.toThrow(
        'Indica al menos un campo o precio con un valor distinto al actual del parámetro',
      );
    });

    it('rechaza null en campos obligatorios, pero permite limpiar units', async () => {
      await expect(
        service.parseData(
          'STUDY_UPDATE',
          { studyId, name: null },
          { branchId },
        ),
      ).rejects.toThrow('Estos campos no pueden ser null: name');

      await expect(
        service.parseData(
          'STUDY_UPDATE',
          { studyId, units: null },
          { branchId },
        ),
      ).resolves.toEqual({ studyId, units: null });
    });

    it('valida decimals y edades contra los valores actuales del parámetro', async () => {
      prisma.study.findUnique.mockResolvedValue({
        ...currentStudy(),
        isPanel: true,
      });

      await expect(
        service.parseData(
          'STUDY_UPDATE',
          { studyId, decimals: 1 },
          { branchId },
        ),
      ).rejects.toThrow('decimals no aplica a un perfil (isPanel = true)');

      await service.parseData(
        'STUDY_UPDATE',
        { studyId, minAge: 18 },
        { branchId },
      );
      expect(studiesService.assertValidAgeRange).toHaveBeenLastCalledWith(
        18,
        120,
      );
    });

    it('al aprobar actualiza solo lo que cambió, incluidos ajustes de TI y precios', async () => {
      prisma.priceSheets.findMany.mockResolvedValue([
        { id: sheetA, name: 'General' },
        { id: sheetB, name: 'Convenio' },
      ]);
      studiesService.update.mockResolvedValue({
        id: studyId,
        code: 'GLU2',
        name: 'Glucosa sérica',
      });

      const result = await service.apply(
        'STUDY_UPDATE',
        {
          studyId,
          name: 'Glucosa sérica',
          units: 'mg/dL',
          prices: [
            { priceSheetId: sheetA, price: 150 },
            { priceSheetId: sheetB, price: 99.9 },
          ],
        },
        { code: 'GLU2', abbreviation: 'GLU' },
        { branchId },
      );

      expect(studiesService.update).toHaveBeenCalledWith(studyId, {
        name: 'Glucosa sérica',
        code: 'GLU2',
      });
      expect(prisma.studyOnPriceSheet.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.studyOnPriceSheet.upsert).toHaveBeenCalledWith({
        where: { studyId_priceSheetId: { studyId, priceSheetId: sheetB } },
        update: { price: new Prisma.Decimal(99.9) },
        create: {
          studyId,
          priceSheetId: sheetB,
          price: new Prisma.Decimal(99.9),
        },
      });
      expect(result).toEqual({
        result: {
          studyId,
          code: 'GLU2',
          name: 'Glucosa sérica',
          changes: {
            name: { from: 'Glucosa', to: 'Glucosa sérica' },
            code: { from: 'GLU', to: 'GLU2' },
          },
          priceChanges: {
            [sheetB]: { priceSheet: 'Convenio', from: null, to: 99.9 },
          },
        },
        summary:
          'actualizó el parámetro GLU2 - Glucosa sérica (nombre; código; precios: Convenio)',
      });
    });

    it('al aprobar solo precios no toca los datos del parámetro', async () => {
      prisma.priceSheets.findMany.mockResolvedValue([
        { id: sheetA, name: 'General' },
      ]);

      const result = await service.apply(
        'STUDY_UPDATE',
        { studyId, prices: [{ priceSheetId: sheetA, price: 180 }] },
        {},
        { branchId },
      );

      expect(studiesService.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.summary).toBe(
        'actualizó el parámetro GLU - Glucosa (precios: General)',
      );
    });

    it('al aprobar acepta cambios solo de TI aunque lo solicitado ya esté aplicado', async () => {
      studiesService.update.mockResolvedValue({
        id: studyId,
        code: 'GLU',
        name: 'Glucosa',
      });

      await service.apply(
        'STUDY_UPDATE',
        { studyId, units: 'mg/dL' },
        { title: 'Glucosa en ayuno' },
        { branchId },
      );

      expect(studiesService.update).toHaveBeenCalledWith(studyId, {
        title: 'Glucosa en ayuno',
      });
    });

    it('al aprobar falla si el parámetro ya tiene esos valores', async () => {
      prisma.study.findUnique.mockResolvedValue({
        ...currentStudy(),
        units: 'mmol/L',
      });

      await expect(
        service.apply(
          'STUDY_UPDATE',
          { studyId, units: 'mmol/L' },
          {},
          { branchId },
        ),
      ).rejects.toThrow(
        'El parámetro ya tiene los valores solicitados: no hay nada que actualizar',
      );
      expect(studiesService.update).not.toHaveBeenCalled();
    });
  });

  describe('STUDY_CREATE con perfil (panelItems)', () => {
    const existingChild = '66666666-6666-4666-8666-666666666666';
    const newChild = () => ({
      name: 'Colesterol HDL',
      sectionId: 1,
      sampleTypeId: 2,
      techniqueId: 3,
      gender: 'A',
      ageFormat: 'AÑOS',
      minAge: 0,
      maxAge: 120,
      decimals: 1,
      units: 'mg/dL',
    });
    const panelForm = () => {
      const { decimals: _omit, ...form } = validForm();
      return {
        ...form,
        name: 'Perfil de lípidos',
        isPanel: true,
        panelItems: [
          { studyId: existingChild },
          { newStudy: newChild() },
          { newStudy: { ...newChild(), name: 'Colesterol LDL' } },
        ],
      };
    };
    const applyPanel = {
      code: 'PLIP',
      serviceId: '44444444-4444-4444-8444-444444444444',
      newStudies: [{ code: 'HDL' }, { code: 'LDL', abbreviation: 'LDL' }],
    };

    beforeEach(() => {
      prisma.study.count.mockResolvedValue(1);
    });

    it('acepta parámetros existentes y nuevos, y valida cada hijo nuevo', async () => {
      await service.parseData('STUDY_CREATE', panelForm(), { branchId });

      expect(prisma.study.count).toHaveBeenCalledWith({
        where: { id: { in: [existingChild] }, branchId },
      });
      expect(studiesService.assertCatalogsBelongToBranch).toHaveBeenCalledTimes(
        3,
      );
    });

    it('los hijos nuevos no llevan precios ni isPanel', async () => {
      const form = panelForm();
      form.panelItems[1] = {
        newStudy: { ...newChild(), prices: [], isPanel: true },
      } as never;

      const { message } = await messagesOf(
        service.parseData('STUDY_CREATE', form, { branchId }, 'form'),
      );

      expect([...message].sort()).toEqual([
        'form.panelItems.1.newStudy.property isPanel should not exist',
        'form.panelItems.1.newStudy.property prices should not exist',
      ]);
    });

    it('rechaza panelItems si no es perfil', async () => {
      await expect(
        service.parseData(
          'STUDY_CREATE',
          { ...validForm(), panelItems: [{ studyId: existingChild }] },
          { branchId },
        ),
      ).rejects.toThrow('panelItems solo aplica cuando isPanel = true');
    });

    it('exige studyId o newStudy, pero no ambos', async () => {
      const form = panelForm();
      form.panelItems[0] = { studyId: existingChild, newStudy: newChild() };

      await expect(
        service.parseData('STUDY_CREATE', form, { branchId }),
      ).rejects.toThrow(
        'panelItems.0: indica studyId (parámetro existente) o newStudy (parámetro nuevo), solo uno',
      );
    });

    it('rechaza parámetros existentes de otra sucursal o inexistentes', async () => {
      prisma.study.count.mockResolvedValue(0);

      await expect(
        service.parseData('STUDY_CREATE', panelForm(), { branchId }),
      ).rejects.toThrow(
        'Todos los parámetros existentes del perfil deben existir y pertenecer a la sucursal del ticket',
      );
    });

    it('al aprobar crea el perfil con precios, los hijos sin precios y los enlaza en orden', async () => {
      studiesService.create
        .mockResolvedValueOnce({
          id: 'panel-1',
          code: 'PLIP',
          name: 'Perfil de lípidos',
        })
        .mockResolvedValueOnce({ id: 'hdl-1', code: 'HDL', name: 'HDL' })
        .mockResolvedValueOnce({ id: 'ldl-1', code: 'LDL', name: 'LDL' });
      prisma.study.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        { id: existingChild, code: 'TG', name: 'Triglicéridos' },
        { id: 'hdl-1', code: 'HDL', name: 'HDL' },
        { id: 'ldl-1', code: 'LDL', name: 'LDL' },
      ]);

      const result = await service.apply(
        'STUDY_CREATE',
        panelForm(),
        applyPanel,
        { branchId },
      );

      expect(studiesService.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          code: 'PLIP',
          isPanel: true,
          studyPrices: expect.any(Array),
        }),
      );
      expect(studiesService.create).toHaveBeenNthCalledWith(
        1,
        expect.not.objectContaining({ decimals: expect.anything() }),
      );
      expect(studiesService.create).toHaveBeenNthCalledWith(2, {
        ...newChild(),
        code: 'HDL',
        serviceId: applyPanel.serviceId,
        isPanel: false,
        isOrderable: false,
        branchId,
      });
      expect(studiesService.create).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ code: 'LDL', abbreviation: 'LDL' }),
      );
      expect(studiesService.setPanelItems).toHaveBeenCalledWith('panel-1', {
        items: [
          { childId: existingChild },
          { childId: 'hdl-1' },
          { childId: 'ldl-1' },
        ],
      });
      expect(result.summary).toBe(
        'creó el perfil PLIP - Perfil de lípidos con 3 parámetro(s) (nuevos: HDL, LDL)',
      );
      expect(result.result.panelItems).toEqual([
        {
          studyId: existingChild,
          code: 'TG',
          name: 'Triglicéridos',
          isNew: false,
        },
        { studyId: 'hdl-1', code: 'HDL', name: 'HDL', isNew: true },
        { studyId: 'ldl-1', code: 'LDL', name: 'LDL', isNew: true },
      ]);
    });

    it('al aprobar exige datos de TI para cada hijo nuevo', async () => {
      await expect(
        service.apply(
          'STUDY_CREATE',
          panelForm(),
          { ...applyPanel, newStudies: [{ code: 'HDL' }] },
          { branchId },
        ),
      ).rejects.toThrow(
        'Captura en newStudies los datos de TI (code, etc.) de los 2 parámetro(s) nuevo(s) del perfil',
      );
      expect(studiesService.create).not.toHaveBeenCalled();
    });

    it('al aprobar rechaza códigos repetidos o ya usados antes de crear nada', async () => {
      await expect(
        service.apply(
          'STUDY_CREATE',
          panelForm(),
          { ...applyPanel, newStudies: [{ code: 'HDL' }, { code: 'HDL' }] },
          { branchId },
        ),
      ).rejects.toThrow('Códigos repetidos en la solicitud: HDL');

      prisma.study.findMany.mockResolvedValueOnce([{ code: 'LDL' }]);
      await expect(
        service.apply('STUDY_CREATE', panelForm(), applyPanel, { branchId }),
      ).rejects.toThrow(ConflictException);
      expect(studiesService.create).not.toHaveBeenCalled();
    });

    it('si falla a medio camino, borra lo creado en orden inverso', async () => {
      studiesService.create
        .mockResolvedValueOnce({ id: 'panel-1', code: 'PLIP', name: 'P' })
        .mockResolvedValueOnce({ id: 'hdl-1', code: 'HDL', name: 'HDL' })
        .mockRejectedValueOnce(new ConflictException('code'));

      await expect(
        service.apply('STUDY_CREATE', panelForm(), applyPanel, { branchId }),
      ).rejects.toThrow(ConflictException);

      expect(studiesService.remove.mock.calls).toEqual([
        ['hdl-1'],
        ['panel-1'],
      ]);
      expect(studiesService.setPanelItems).not.toHaveBeenCalled();
    });
  });
});
