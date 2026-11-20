import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { BranchInternetProvider } from '@prisma/client';

const BRANCH_WRITE_INCLUDE = {
  address: true,
  state: true,
  schedules: {
    orderBy: { dayOfWeek: 'asc' as const },
  },
  internetProvider: true,
};

export const toInternetProviderResponse = (
  provider: BranchInternetProvider | null,
) =>
  provider && {
    id: provider.id,
    nameProvider: provider.nameProvider,
    accountNumber: provider.accountNumber,
    monthlyPrice: Number(provider.monthlyPrice),
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createBranchDto: CreateBranchDto) {
    const { address, stateId, schedules, internetProvider, ...branchData } =
      createBranchDto;

    const existingBranch = await this.prisma.branch.findUnique({
      where: { name: branchData.name },
    });

    if (existingBranch) {
      throw new ConflictException(
        `Branch with name '${branchData.name}' already exists`,
      );
    }

    const branch = await this.prisma.branch.create({
      data: {
        ...branchData,
        state: {
          connect: { id: stateId },
        },
        address: {
          create: address,
        },
        ...(schedules?.length && {
          schedules: {
            create: schedules,
          },
        }),
        ...(internetProvider && {
          internetProvider: { create: internetProvider },
        }),
      },
      include: BRANCH_WRITE_INCLUDE,
    });

    return {
      ...branch,
      internetProvider: toInternetProviderResponse(branch.internetProvider),
    };
  }

  async findAll(isVisible?: boolean) {
    return this.prisma.branch.findMany({
      where: isVisible !== undefined ? { isVisible } : undefined,
      include: {
        address: true,
        priceSheets: true,
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
        branchId: id,
      },
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
    const { address, stateId, schedules, internetProvider, ...branchData } =
      updateBranchDto;

    await this.findOne(id);

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

    const branch = await this.prisma.$transaction(async (tx) => {
      if (internetProvider === null) {
        await tx.branchInternetProvider.deleteMany({ where: { branchId: id } });
      }

      return tx.branch.update({
        where: { id },
        data: {
          ...branchData,
          ...(stateId && {
            state: {
              connect: { id: stateId },
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
          ...(internetProvider && {
            internetProvider: {
              upsert: { create: internetProvider, update: internetProvider },
            },
          }),
        },
        include: BRANCH_WRITE_INCLUDE,
      });
    });

    return {
      ...branch,
      internetProvider: toInternetProviderResponse(branch.internetProvider),
    };
  }

  async findInternetProvider(id: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      select: { internetProvider: true },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID #${id} not found`);
    }

    return toInternetProviderResponse(branch.internetProvider);
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.branch.delete({
      where: { id },
    });
  }
}
