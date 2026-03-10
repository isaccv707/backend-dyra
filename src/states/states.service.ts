import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateStateDto } from './dto/create-state.dto';
import { UpdateStateDto } from './dto/update-state.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';

@Injectable()
export class StatesService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createStateDto: CreateStateDto) {
    const existingState = await this.prisma.state.findUnique({
      where: { name: createStateDto.name },
    });

    if (existingState) {
      throw new ConflictException(`State with name '${createStateDto.name}' already exists`);
    }

    return this.prisma.state.create({
      data: createStateDto,
    });
  }

  async findAll() {
    return this.prisma.state.findMany({
      include: {
        _count: {
          select: { branches: true },
        },
      },
    });
  }

  async findOne(id: number) {
    const state = await this.prisma.state.findUnique({
      where: { id },
      include: {
        branches: true,
      },
    });

    if (!state) {
      throw new NotFoundException(`State with ID #${id} not found`);
    }

    return state;
  }

  async update(id: number, updateStateDto: UpdateStateDto) {
    await this.findOne(id);

    if (updateStateDto.name) {
      const existingState = await this.prisma.state.findUnique({
        where: { name: updateStateDto.name },
      });

      if (existingState && existingState.id !== id) {
        throw new ConflictException(`State with name '${updateStateDto.name}' already exists`);
      }
    }

    return this.prisma.state.update({
      where: { id },
      data: updateStateDto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.state.delete({
      where: { id },
    });
  }
}
