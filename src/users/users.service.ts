import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from '../common/handle-db-errors';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginatedQueryDto } from '../common/dto/paginated-query.dto';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from '../common/utils/paginate.util';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  role: {
    select: {
      id: true,
      name: true,
      description: true,
    },
  },
  branches: {
    select: { id: true, name: true },
  },
} satisfies Prisma.UserSelect;

const ADMIN_ROLE_NAME = 'Administrador';

const USER_ALLOWED_FIELDS = [
  'name',
  'email',
  'isActive',
  'createdAt',
  'updatedAt',
  'role.name',
];

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    const { password, roleId, branchIds, ...userData } = createUserDto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email: userData.email },
    });
    if (existingUser) {
      throw new ConflictException(
        `User with email '${userData.email}' already exists`,
      );
    }

    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException(`Role with ID '${roleId}' not found`);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      return await this.prisma.user.create({
        data: {
          ...userData,
          password: hashedPassword,
          role: { connect: { id: roleId } },
          ...(branchIds?.length && {
            branches: { connect: branchIds.map((id) => ({ id })) },
          }),
        },
        select: USER_SELECT,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'User');
    }
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: USER_SELECT,
    });
  }

  async findAllPaginated(dto: PaginatedQueryDto) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'email'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: USER_ALLOWED_FIELDS,
    });

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip,
        take,
        where: where as Prisma.UserWhereInput,
        orderBy,
        select: USER_SELECT,
      }),
      this.prisma.user.count({ where: where as Prisma.UserWhereInput }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found`);
    }

    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.findOne(id);

    const { password, roleId, branchIds, ...userData } = updateUserDto;

    const isRootUser = this.isRootUser(user.email);

    if (isRootUser) {
      if (userData.email !== undefined && userData.email !== user.email) {
        throw new ForbiddenException(
          'El email del usuario raíz del sistema no puede ser modificado',
        );
      }
      if (userData.isActive === false) {
        throw new ForbiddenException(
          'El usuario raíz del sistema no puede ser desactivado',
        );
      }
    }

    if (roleId) {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } });
      if (!role) {
        throw new NotFoundException(`Role with ID '${roleId}' not found`);
      }
      if (isRootUser && role.name !== ADMIN_ROLE_NAME) {
        throw new ForbiddenException(
          `El usuario raíz del sistema debe conservar el rol ${ADMIN_ROLE_NAME}`,
        );
      }
    }

    const hashedPassword = password
      ? await bcrypt.hash(password, 10)
      : undefined;

    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...userData,
          ...(hashedPassword && { password: hashedPassword }),
          ...(roleId && { role: { connect: { id: roleId } } }),
          ...(branchIds !== undefined && {
            branches: { set: branchIds.map((id) => ({ id })) },
          }),
        },
        select: USER_SELECT,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'User');
    }
  }

  async remove(id: string, currentUserId: string) {
    const user = await this.findOne(id);

    if (this.isRootUser(user.email)) {
      throw new ForbiddenException(
        'El usuario raíz del sistema no puede ser eliminado',
      );
    }

    if (id === currentUserId) {
      throw new ForbiddenException('No puedes eliminar tu propio usuario');
    }

    try {
      return await this.prisma.user.delete({
        where: { id },
        select: USER_SELECT,
      });
    } catch (error) {
      // Users referenced by tickets, safeguards, etc. are deactivated instead.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        return this.prisma.user.update({
          where: { id },
          data: { isActive: false },
          select: USER_SELECT,
        });
      }
      handleDatabaseErrors(error, 'User');
    }
  }

  private isRootUser(email: string) {
    const rootEmail = process.env.ADMIN_EMAIL;
    return !!rootEmail && email.toLowerCase() === rootEmail.toLowerCase();
  }
}
