import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { UsersService } from './users.service';

const ROOT_EMAIL = 'root@dyra.com';
const ADMIN_ROLE = { id: 'role-admin', name: 'Administrador' };
const USER_ROLE = { id: 'role-user', name: 'Usuario' };

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    role: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  const user = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'ana@dyra.com',
    name: 'Ana',
    isActive: true,
    role: USER_ROLE,
    branches: [],
    ...overrides,
  });
  const rootUser = () =>
    user({ id: 'root-1', email: ROOT_EMAIL, role: ADMIN_ROLE });

  beforeEach(async () => {
    process.env.ADMIN_EMAIL = ROOT_EMAIL;
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn((args: { data: unknown }) => args.data),
        update: jest.fn((args: { data: unknown }) => args.data),
        delete: jest.fn(),
      },
      role: { findUnique: jest.fn() },
      $transaction: jest.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  afterAll(() => {
    process.env.ADMIN_EMAIL = originalAdminEmail;
  });

  describe('create', () => {
    const dto = {
      email: 'nuevo@dyra.com',
      password: 'secret123',
      name: 'Nuevo',
      roleId: USER_ROLE.id,
    };

    it('hashes the password and never selects it back', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue(USER_ROLE);

      await service.create(dto);

      const args = prisma.user.create.mock.calls[0][0] as {
        data: { password: string; role: unknown };
        select: Record<string, unknown>;
      };
      expect(args.data.password).not.toBe('secret123');
      await expect(
        bcrypt.compare('secret123', args.data.password),
      ).resolves.toBe(true);
      expect(args.data.role).toEqual({ connect: { id: USER_ROLE.id } });
      expect(args.select).not.toHaveProperty('password');
    });

    it('rejects a duplicated email with 409', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('rejects an unknown role with 404', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue(null);
      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllPaginated', () => {
    it('applies paging, search and an allowed sort field', async () => {
      prisma.user.count.mockResolvedValue(25);

      const result = await service.findAllPaginated({
        page: 2,
        limit: 10,
        search: 'ana',
        sort: { field: 'role.name', order: 'asc' },
      } as never);

      const args = prisma.user.findMany.mock.calls[0][0] as {
        skip: number;
        take: number;
        where: { OR?: unknown[] };
        orderBy: unknown;
      };
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(JSON.stringify(args.where)).toContain('ana');
      expect(args.orderBy).toEqual({ role: { name: 'asc' } });
      expect(result).toMatchObject({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
      });
    });

    it.each([
      ['sort', { sort: { field: 'password', order: 'asc' } }],
      [
        'filter',
        {
          filters: {
            and: [{ field: 'password', operator: 'eq', value: 'x' }],
          },
        },
      ],
    ])('rejects a %s field outside the whitelist with 400', async (_, dto) => {
      await expect(service.findAllPaginated(dto as never)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws 404 when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('only hashes the password when it is sent', async () => {
      prisma.user.findUnique.mockResolvedValue(user());

      await service.update('user-1', { name: 'Ana María' });
      const { data } = prisma.user.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data).not.toHaveProperty('password');
    });

    it('rejects an unknown role with 404', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(
        service.update('user-1', { roleId: 'missing' }),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([
      ['change its email', { email: 'otro@dyra.com' }],
      ['deactivate it', { isActive: false }],
    ])('does not let anyone %s on the root user', async (_, dto) => {
      prisma.user.findUnique.mockResolvedValue(rootUser());

      await expect(service.update('root-1', dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('does not let the root user lose the Administrador role', async () => {
      prisma.user.findUnique.mockResolvedValue(rootUser());
      prisma.role.findUnique.mockResolvedValue(USER_ROLE);

      await expect(
        service.update('root-1', { roleId: USER_ROLE.id }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('still lets the root user update other fields', async () => {
      prisma.user.findUnique.mockResolvedValue(rootUser());
      prisma.role.findUnique.mockResolvedValue(ADMIN_ROLE);

      await expect(
        service.update('root-1', {
          name: 'Root',
          email: ROOT_EMAIL,
          isActive: true,
          roleId: ADMIN_ROLE.id,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('remove', () => {
    it('never deletes the root user', async () => {
      prisma.user.findUnique.mockResolvedValue(rootUser());
      await expect(service.remove('root-1', 'user-2')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('does not let a user delete themselves', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      await expect(service.remove('user-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('deletes a user without related records', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      prisma.user.delete.mockResolvedValue(user());

      await service.remove('user-1', 'admin-1');
      expect(prisma.user.delete).toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('deactivates instead when related records block the delete', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      prisma.user.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('fk', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      );

      await service.remove('user-1', 'admin-1');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { isActive: false },
        }),
      );
    });
  });
});
