import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { branchScopeWhere } from 'src/common/utils/branch-scope.util';
import { Prisma } from '@prisma/client';

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createBranchDto: CreateBranchDto) {
    const { address, stateId, priceSheetId, schedules, ...branchData } =
      createBranchDto;

    const existingBranch = await this.prisma.branch.findUnique({
      where: { name: branchData.name },
    });

    if (existingBranch) {
      throw new ConflictException(
        `Branch with name '${branchData.name}' already exists`,
      );
    }

    return this.prisma.branch.create({
      data: {
        ...branchData,
        state: {
          connect: { id: stateId },
        },
        address: {
          create: address,
        },
        ...(priceSheetId && {
          priceSheet: {
            connect: { id: priceSheetId },
          },
        }),
        ...(schedules?.length && {
          schedules: {
            create: schedules,
          },
        }),
      },
      include: {
        address: true,
        state: true,
        schedules: {
          orderBy: { dayOfWeek: 'asc' },
        },
      },
    });
  }

  async findAll() {
    return this.prisma.branch.findMany({
      include: {
        address: true,
        priceSheet: true,
        state: true,
      },
    });
  }

  async findOne(id: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      include: {
        address: true,
        state: true,
        schedules: {
          orderBy: { dayOfWeek: 'asc' },
        },
      },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID #${id} not found`);
    }

    const services = await this.prisma.service.findMany({
      where: {
        isActive: true,
        ...branchScopeWhere(id),
      } as Prisma.ServiceWhereInput,
      include: {
        benefits: true,
        details: true,
        _count: {
          select: { studies: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return { ...branch, services };
  }

  async update(id: string, updateBranchDto: UpdateBranchDto) {
    const { address, stateId, priceSheetId, schedules, ...branchData } =
      updateBranchDto;

    // Ensure branch exists
    await this.findOne(id);

    // Check if new name is already taken by another branch
    if (branchData.name) {
      const existingBranch = await this.prisma.branch.findUnique({
        where: { name: branchData.name },
      });

      if (existingBranch && existingBranch.id !== id) {
        throw new ConflictException(
          `Branch with name '${branchData.name}' already exists`,
        );
      }
    }

    return this.prisma.branch.update({
      where: { id },
      data: {
        ...branchData,
        ...(stateId && {
          state: {
            connect: { id: stateId },
          },
        }),
        ...(priceSheetId && {
          priceSheet: {
            connect: { id: priceSheetId },
          },
        }),
        ...(address && {
          address: {
            update: address,
          },
        }),
        ...(schedules !== undefined && {
          schedules: {
            deleteMany: {},
            create: schedules,
          },
        }),
      },
      include: {
        address: true,
        state: true,
        schedules: {
          orderBy: { dayOfWeek: 'asc' },
        },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.branch.delete({
      where: { id },
    });
  }

  async resolveBranchPriceSheetId(branchId: string): Promise<string | null> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { priceSheetId: true },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID '${branchId}' not found`);
    }

    return branch.priceSheetId;
  }
}
