import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createBranchDto: CreateBranchDto) {
    const { address, stateId, priceSheetId, ...branchData } = createBranchDto;

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
      },
      include: {
        address: true,
        state: true,
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
      },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID #${id} not found`);
    }

    return branch;
  }

  // async update(id: string, updateBranchDto: UpdateBranchDto) {
  //   const { address, stateId, ...branchData } = updateBranchDto;

  //   // Ensure branch exists
  //   await this.findOne(id);

  //   // Check if new name is already taken by another branch
  //   if (branchData.name) {
  //     const existingBranch = await this.prisma.branch.findUnique({
  //       where: { name: branchData.name },
  //     });

  //     if (existingBranch && existingBranch.id !== id) {
  //       throw new ConflictException(
  //         `Branch with name '${branchData.name}' already exists`,
  //       );
  //     }
  //   }

  //   return this.prisma.branch.update({
  //     where: { id },
  //     data: {
  //       ...branchData,
  //       ...(stateId && {
  //         state: {
  //           connect: { id: stateId },
  //         },
  //       }),
  //       ...(address && {
  //         address: {
  //           update: address,
  //         },
  //       }),
  //     },
  //     include: {
  //       address: true,
  //       state: true,
  //     },
  //   });
  // }

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
