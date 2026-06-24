import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const ROLE_INCLUDE = {
  permissions: true,
} as const;

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createRoleDto: CreateRoleDto) {
    const { permissionIds, ...roleData } = createRoleDto;
    try {
      return await this.prisma.role.create({
        data: {
          ...roleData,
          ...(permissionIds?.length && {
            permissions: {
              connect: permissionIds.map((id) => ({ id })),
            },
          }),
        },
        include: ROLE_INCLUDE,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Role');
    }
  }

  async findAll() {
    return this.prisma.role.findMany({ include: ROLE_INCLUDE });
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: ROLE_INCLUDE,
    });
    if (!role) throw new NotFoundException(`Role with ID #${id} not found`);
    return role;
  }

  async update(id: string, updateRoleDto: UpdateRoleDto) {
    const { permissionIds, ...roleData } = updateRoleDto;
    await this.findOne(id);
    try {
      return await this.prisma.role.update({
        where: { id },
        data: {
          ...roleData,
          ...(permissionIds !== undefined && {
            permissions: {
              set: permissionIds.map((id) => ({ id })),
            },
          }),
        },
        include: ROLE_INCLUDE,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Role');
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      return await this.prisma.role.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, 'Role');
    }
  }
}
