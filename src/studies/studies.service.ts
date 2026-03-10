import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CreateStudyDto } from './dto/create-study.dto';
import { plainToInstance } from 'class-transformer';
import { toOptionalBool, toOptionalInt, toRequiredNumber } from './utils/excel-normalizers';
import { v4 as uuid } from 'uuid';
import * as XLSX from "xlsx";
import { validate } from 'class-validator';
import { PaginationDto } from './dto/pagination-study.dto';
import { Prisma } from "@prisma/client";
import { generateSlug } from 'src/common/utils/slugger.util';

@Injectable()
export class StudiesService {
  constructor(private readonly prisma: PrismaService) { }

  create(createStudyDto: CreateStudyDto) {
    const { name, } = createStudyDto;
    const slug = generateSlug(name)
    return this.prisma.study.create({
      data: {
        id: uuid(),
        ...createStudyDto,
        slug,
      },
    });
  }

  async findAll({ limit = 10, page = 1, search }: PaginationDto) {
    const skip = (page - 1) * limit;
    const term = search?.trim().replace(/\s+/g, " ");
    const MIN_SEARCH_LEN = 2;
    const effectiveTerm = term && term.length >= MIN_SEARCH_LEN ? term : undefined;
    const where: Prisma.StudyWhereInput | undefined = term
      ? {
        OR: [
          { name: { contains: effectiveTerm, mode: Prisma.QueryMode.insensitive } },
          { code: { contains: effectiveTerm, mode: Prisma.QueryMode.insensitive } },
        ],
      }
      : undefined;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        skip,
        take: limit,
        where,
        orderBy: { name: 'asc' },
      }),
      this.prisma.study.count({ where }),
    ])

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      }
    };
  }

  async findOne(id: string) {
    const study = await this.prisma.study.findFirst({
      where: {
        OR: [
          { id },
          { slug: id }
        ]
      }
    });
    if (!study) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }
    return study;
  }

  async importFromExcel(buffer: Buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new BadRequestException("El archivo de Excel no contiene hojas.");

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
      defval: null,
      raw: false,
      blankrows: false,
    });

    if (!rows.length) {
      throw new BadRequestException("El Excel no contiene filas de datos");
    }
    const valid: CreateStudyDto[] = [];
    const invalid: Array<{ row: number; code?: string; errors: string[] }> = [];

    for (let i = 0; i < rows.length; i++) {
      const initialRow = i + 2;

      const name = rows[i].name.toString()?.trim()

      const normalizedData = {
        name,
        code: rows[i].code.toString()?.trim(),
        slug: generateSlug(name),
        description: rows[i]?.description?.toString()?.trim() ?? undefined,
        sampleType: rows[i]?.sampleType?.toString()?.trim() ?? undefined,
        preparation: rows[i]?.preparation?.toString()?.trim() ?? undefined,
        price: toRequiredNumber(rows[i].price),

        deliveryTime: toOptionalInt(rows[i].deliveryTime),
        isActive: toOptionalBool(rows[i].isActive),
      }
      const dto = plainToInstance(CreateStudyDto, normalizedData, {
        enableImplicitConversion: true,
      });


      const errors = await validate(dto, { whitelist: true });

      if (errors.length) {
        invalid.push({
          row: initialRow,
          code: dto.code,
          errors: errors.flatMap((e) => Object.values(e.constraints ?? {})),
        })
      } else {
        valid.push(dto);
      }
    }

    let created = 0;
    let updated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const item of valid) {
        const exists = await tx.study.findUnique({ where: { code: item.code } });

        await tx.study.upsert({
          where: { code: item.code },
          create: {
            id: uuid(),
            ...item,
          } as Prisma.StudyCreateInput,
          update: {
            ...item,
          } as Prisma.StudyCreateInput,
        });

        exists ? updated++ : created++;
      }
    });

    return {
      sheetName,
      totalRows: rows.length,
      validRows: valid.length,
      created,
      updated,
    }
  }
}


