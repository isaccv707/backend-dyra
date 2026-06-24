import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createPermissionDto: CreatePermissionDto) {
    try {
      return await this.prisma.permission.create({ data: createPermissionDto });
    } catch (error) {
      handleDatabaseErrors(error, 'Permission');
    }
  }

  async findAll() {
    return this.prisma.permission.findMany({
      orderBy: { action: 'asc' },
    });
  }

  async findOne(id: string) {
    const permission = await this.prisma.permission.findUnique({ where: { id } });
    if (!permission) throw new NotFoundException(`Permission with ID #${id} not found`);
    return permission;
  }

  async update(id: string, updatePermissionDto: UpdatePermissionDto) {
    await this.findOne(id);
    try {
      return await this.prisma.permission.update({
        where: { id },
        data: updatePermissionDto,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Permission');
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      return await this.prisma.permission.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, 'Permission');
    }
  }
}
