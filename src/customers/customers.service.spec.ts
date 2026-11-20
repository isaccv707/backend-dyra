import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CustomersService } from './customers.service';

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const SHEET_ID = '44444444-4444-4444-8444-444444444444';
const user = { branches: [{ id: BRANCH_ID }] };
const outsider = { branches: [{ id: OTHER_BRANCH_ID }] };

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: CUSTOMER_ID,
  name: 'Empresa SA',
  email: 'pagos@empresa.mx',
  accountsReceivable: false,
  liquidate: true,
  isActive: true,
  contractAmount: new Prisma.Decimal('1500.50'),
  patientAmount: null,
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: new Date('2026-12-31T00:00:00.000Z'),
  priceSheetId: null,
  priceSheet: null,
  branchId: BRANCH_ID,
  createdAt: new Date('2026-11-19T10:00:00.000Z'),
  updatedAt: new Date('2026-11-19T10:00:00.000Z'),
  ...overrides,
});

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: {
    branch: { findUnique: jest.Mock };
    priceSheets: { findUnique: jest.Mock };
    customer: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      branch: { findUnique: jest.fn().mockResolvedValue({ id: BRANCH_ID }) },
      priceSheets: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ branchId: BRANCH_ID, isActive: true }),
      },
      customer: {
        create: jest.fn().mockResolvedValue(stored()),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([stored()]),
        findUnique: jest.fn().mockResolvedValue(stored()),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(stored()),
        delete: jest.fn().mockResolvedValue(stored()),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  const base = {
    name: 'Empresa SA',
    email: 'pagos@empresa.mx',
    branchId: BRANCH_ID,
  };

  describe('create', () => {
    it('crea con modalidad por defecto (liquida) y fechas sin hora', async () => {
      await service.create(
        { ...base, startDate: '2026-01-01', contractAmount: 1500.5 },
        user,
      );

      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountsReceivable: false,
            liquidate: true,
            isActive: true,
            priceSheetId: null,
            contractAmount: 1500.5,
            startDate: new Date('2026-01-01T00:00:00.000Z'),
            endDate: null,
          }) as unknown,
        }),
      );
    });

    it('accountsReceivable=true guarda liquidate=false', async () => {
      await service.create({ ...base, accountsReceivable: true }, user);

      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountsReceivable: true,
            liquidate: false,
          }) as unknown,
        }),
      );
    });

    it('rechaza CxC y liquida al mismo tiempo', async () => {
      await expect(
        service.create(
          { ...base, accountsReceivable: true, liquidate: true },
          user,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('rechaza fin de vigencia anterior al inicio', async () => {
      await expect(
        service.create(
          { ...base, startDate: '2026-05-01', endDate: '2026-04-30' },
          user,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza nombre repetido sin distinguir mayúsculas', async () => {
      prisma.customer.findFirst.mockResolvedValue({ name: 'Empresa SA' });

      await expect(
        service.create({ ...base, name: 'EMPRESA SA' }, user),
      ).rejects.toThrow(ConflictException);
    });

    it('rechaza sucursal no asignada al usuario', async () => {
      await expect(service.create(base, outsider)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('responde 404 si la sucursal no existe', async () => {
      prisma.branch.findUnique.mockResolvedValue(null);
      await expect(service.create(base, user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('asocia una hoja de precios activa de la misma sucursal', async () => {
      await service.create({ ...base, priceSheetId: SHEET_ID }, user);

      expect(prisma.priceSheets.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: SHEET_ID } }),
      );
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priceSheetId: SHEET_ID }) as unknown,
        }),
      );
    });

    it('rechaza hoja de precios de otra sucursal', async () => {
      prisma.priceSheets.findUnique.mockResolvedValue({
        branchId: OTHER_BRANCH_ID,
        isActive: true,
      });

      await expect(
        service.create({ ...base, priceSheetId: SHEET_ID }, user),
      ).rejects.toThrow('misma sucursal');
    });

    it('rechaza hoja de precios inactiva', async () => {
      prisma.priceSheets.findUnique.mockResolvedValue({
        branchId: BRANCH_ID,
        isActive: false,
      });

      await expect(
        service.create({ ...base, priceSheetId: SHEET_ID }, user),
      ).rejects.toThrow('inactiva');
    });

    it('responde 404 si la hoja de precios no existe', async () => {
      prisma.priceSheets.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ ...base, priceSheetId: SHEET_ID }, user),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('limita a las sucursales del usuario, aplica filtros y serializa', async () => {
      const result = await service.findAll(
        { isActive: true, accountsReceivable: false, priceSheetId: SHEET_ID },
        user,
      );

      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            branchId: { in: [BRANCH_ID] },
            isActive: true,
            accountsReceivable: false,
            priceSheetId: SHEET_ID,
          }) as unknown,
        }),
      );
      expect(result.data[0]).toMatchObject({
        contractAmount: 1500.5,
        patientAmount: null,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });
      expect(result.total).toBe(1);
    });

    it('busca por nombre y correo', async () => {
      await service.findAll({ search: 'empresa' }, user);

      const call = prisma.customer.findMany.mock.calls[0] as [
        { where: { OR: unknown[] } },
      ];
      expect(call[0].where.OR).toHaveLength(2);
    });
  });

  describe('findOne', () => {
    it('responde 404 si no existe', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.findOne(CUSTOMER_ID, user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('responde 403 si es de otra sucursal', async () => {
      await expect(service.findOne(CUSTOMER_ID, outsider)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('update', () => {
    it('cambiar a CxC apaga liquidate', async () => {
      await service.update(CUSTOMER_ID, { accountsReceivable: true }, user);

      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountsReceivable: true,
            liquidate: false,
          }) as unknown,
        }),
      );
    });

    it('conserva la modalidad actual si no se envía', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        stored({ accountsReceivable: true, liquidate: false }),
      );

      await service.update(CUSTOMER_ID, { name: 'Nuevo' }, user);

      expect(prisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            NOT: { id: CUSTOMER_ID },
          }) as unknown,
        }),
      );
      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountsReceivable: true,
            liquidate: false,
          }) as unknown,
        }),
      );
    });

    it('valida el periodo contra la fecha guardada', async () => {
      await expect(
        service.update(CUSTOMER_ID, { endDate: '2025-12-31' }, user),
      ).rejects.toThrow('anterior a la fecha de inicio');
    });

    it('permite limpiar campos opcionales con null', async () => {
      await service.update(
        CUSTOMER_ID,
        { priceSheetId: null, contractAmount: null, startDate: null },
        user,
      );

      expect(prisma.priceSheets.findUnique).not.toHaveBeenCalled();
      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priceSheetId: null,
            contractAmount: null,
            startDate: null,
          }) as unknown,
        }),
      );
    });

    it('no revalida la hoja de precios si no cambia', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        stored({ priceSheetId: SHEET_ID }),
      );

      await service.update(CUSTOMER_ID, { priceSheetId: SHEET_ID }, user);

      expect(prisma.priceSheets.findUnique).not.toHaveBeenCalled();
    });

    it('solo envía a Prisma columnas editables (sin modalidad en el body)', async () => {
      await service.update(CUSTOMER_ID, { name: 'Nuevo' }, user);

      const [args] = prisma.customer.update.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      const sentKeys = Object.entries(args.data)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key)
        .sort();
      expect(sentKeys).toEqual(['accountsReceivable', 'liquidate', 'name']);
    });

    it('rechaza actualizar un cliente de otra sucursal', async () => {
      await expect(
        service.update(CUSTOMER_ID, { name: 'X' }, outsider),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('elimina el cliente', async () => {
      await service.remove(CUSTOMER_ID, user);
      expect(prisma.customer.delete).toHaveBeenCalledWith({
        where: { id: CUSTOMER_ID },
      });
    });

    it('responde 404 si no existe', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.remove(CUSTOMER_ID, user)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.customer.delete).not.toHaveBeenCalled();
    });
  });
});
