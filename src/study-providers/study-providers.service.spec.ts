import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { StudyProvidersService } from './study-providers.service';

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const user = { branches: [{ id: BRANCH_ID }] };
const outsider = { branches: [{ id: 'other-branch' }] };

describe('StudyProvidersService', () => {
  let service: StudyProvidersService;
  let prisma: {
    branch: { findUnique: jest.Mock };
    studyProvider: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const stored = (studies = 0) => ({
    id: PROVIDER_ID,
    name: 'Lab Externo',
    isActive: true,
    branchId: BRANCH_ID,
    _count: { studies },
  });

  beforeEach(async () => {
    prisma = {
      branch: { findUnique: jest.fn().mockResolvedValue({ id: BRANCH_ID }) },
      studyProvider: {
        create: jest.fn().mockResolvedValue(stored()),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(stored()),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue(stored()),
        delete: jest.fn().mockResolvedValue(stored()),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        StudyProvidersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(StudyProvidersService);
  });

  describe('create', () => {
    it('crea el maquilador en la sucursal', async () => {
      await service.create({ name: 'Lab Externo', branchId: BRANCH_ID }, user);

      expect(prisma.studyProvider.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'Lab Externo', branchId: BRANCH_ID },
        }),
      );
    });

    it('rechaza un nombre repetido en la sucursal sin distinguir mayúsculas', async () => {
      prisma.studyProvider.findFirst.mockResolvedValue(stored());

      await expect(
        service.create({ name: 'LAB EXTERNO', branchId: BRANCH_ID }, user),
      ).rejects.toThrow(ConflictException);
      expect(prisma.studyProvider.findFirst).toHaveBeenCalledWith({
        where: {
          branchId: BRANCH_ID,
          name: { equals: 'LAB EXTERNO', mode: 'insensitive' },
        },
      });
    });

    it('rechaza una sucursal no asignada al usuario', async () => {
      await expect(
        service.create({ name: 'Lab', branchId: BRANCH_ID }, outsider),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('limita a las sucursales del usuario y filtra por isActive', async () => {
      await service.findAll({ isActive: true }, user);

      expect(prisma.studyProvider.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            branchId: { in: [BRANCH_ID] },
            isActive: true,
          }) as unknown,
          include: { _count: { select: { studies: true } } },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('responde 404 si no existe', async () => {
      prisma.studyProvider.findUnique.mockResolvedValue(null);

      await expect(service.findOne(PROVIDER_ID, user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('responde 403 si es de otra sucursal', async () => {
      await expect(service.findOne(PROVIDER_ID, outsider)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('update', () => {
    it('valida el nombre excluyendo al propio maquilador', async () => {
      await service.update(PROVIDER_ID, { name: 'Nuevo' }, user);

      expect(prisma.studyProvider.findFirst).toHaveBeenCalledWith({
        where: {
          branchId: BRANCH_ID,
          name: { equals: 'Nuevo', mode: 'insensitive' },
          NOT: { id: PROVIDER_ID },
        },
      });
      expect(prisma.studyProvider.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'Nuevo' } }),
      );
    });

    it('permite desactivarlo aunque esté en uso', async () => {
      prisma.studyProvider.findUnique.mockResolvedValue(stored(3));

      await service.update(PROVIDER_ID, { isActive: false }, user);

      expect(prisma.studyProvider.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('elimina un maquilador sin estudios', async () => {
      await service.remove(PROVIDER_ID, user);

      expect(prisma.studyProvider.delete).toHaveBeenCalledWith({
        where: { id: PROVIDER_ID },
      });
    });

    it('rechaza (409) eliminar un maquilador en uso', async () => {
      prisma.studyProvider.findUnique.mockResolvedValue(stored(2));

      await expect(service.remove(PROVIDER_ID, user)).rejects.toThrow(
        'lo usan 2 estudio(s) o perfil(es)',
      );
      expect(prisma.studyProvider.delete).not.toHaveBeenCalled();
    });
  });
});
