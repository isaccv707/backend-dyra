import { Injectable } from '@nestjs/common';
import { CreateStudyDto } from './dto/create-study.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { v4 as uuid } from 'uuid';

@Injectable()
export class StudiesService {
  constructor(private readonly prisma: PrismaService) { }

  create(createStudyDto: CreateStudyDto) {
    return this.prisma.study.create({
      data: {
        id: uuid(),
        ...createStudyDto,
      },
    });
  }

  findAll() {
    return this.prisma.study.findMany();
  }

  findOne(id: number) {
    return `This action returns a #${id} study`;
  }

  update(id: number, updateStudyDto: UpdateStudyDto) {
    return `This action updates a #${id} study`;
  }

  remove(id: number) {
    return `This action removes a #${id} study`;
  }
}
