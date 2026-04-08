import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CreateStudyDto } from './dto/create-study.dto';
import { plainToInstance } from 'class-transformer';
import {
  toOptionalBool,
  toOptionalInt,
  toRequiredNumber,
} from './utils/excel-normalizers';
import { v4 as uuid } from 'uuid';
import * as XLSX from 'xlsx';
import { validate } from 'class-validator';
import { PaginationDto } from './dto/pagination-study.dto';
import { Prisma } from '@prisma/client';
import { generateSlug } from 'src/common/utils/slugger.util';

@Injectable()
export class StudiesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createStudyDto: CreateStudyDto) {
    const { name, studyPrices, ...studyData } = createStudyDto;
    const slug = generateSlug(name);

    return await this.prisma.study.create({
      data: {
        ...studyData,
        name,
        slug,
        studyPrices: {
          create: studyPrices.map((p) => ({
            price: new Prisma.Decimal(p.price),
            showPrice: p.showPrice ?? true,
            stateId: p.stateId,
          })),
        },
      },
      include: {
        studyPrices: true,
      },
    });
  }

  async findAll({ limit = 10, page = 1, search, stateId }: PaginationDto) {
    const skip = (page - 1) * limit;
    const term = search?.trim().replace(/\s+/g, ' ');
    const MIN_SEARCH_LEN = 2;
    const effectiveTerm =
      term && term.length >= MIN_SEARCH_LEN ? term : undefined;
    const where: Prisma.StudyWhereInput | undefined = term
      ? {
          OR: [
            {
              name: {
                contains: effectiveTerm,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              code: {
                contains: effectiveTerm,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          ],
        }
      : undefined;

    // Use Jalisco (stateId: 1) as default if not provided
    const selectedStateId = stateId || 1;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        skip,
        take: limit,
        where,
        orderBy: { name: 'asc' },
        include: {
          studyPrices: {
            where: { stateId: selectedStateId },
          },
        },
      }),
      this.prisma.study.count({ where }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const study = await this.prisma.study.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
      },
      include: {
        studyPrices: {
          include: {
            state: true,
          },
        },
        service: true,
      },
    });
    if (!study) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }
    return study;
  }

  async importFromExcel(buffer: Buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName)
      throw new BadRequestException('El archivo de Excel no contiene hojas.');

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
      defval: null,
      raw: false,
      blankrows: false,
    });

    if (!rows.length) {
      throw new BadRequestException('El Excel no contiene filas de datos');
    }
    const valid: (CreateStudyDto & { slug: string })[] = [];
    const invalid: Array<{ row: number; code?: string; errors: string[] }> = [];

    for (let i = 0; i < rows.length; i++) {
      const initialRow = i + 2;

      const name = rows[i]?.name?.toString()?.trim() ?? '';
      const code = rows[i]?.code?.toString()?.trim() ?? '';

      if (!name || !code) {
        invalid.push({
          row: initialRow,
          code,
          errors: ['El nombre y el código son obligatorios'],
        });
        continue;
      }

      const normalizedData = {
        name,
        code,
        slug: generateSlug(name),
        description: rows[i]?.description?.toString()?.trim() ?? undefined,
        sampleType: rows[i]?.sampleType?.toString()?.trim() ?? undefined,
        preparation: rows[i]?.preparation?.toString()?.trim() ?? undefined,
        serviceId: rows[i]?.serviceId?.toString()?.trim() ?? undefined,
        deliveryTime: toOptionalInt(rows[i].deliveryTime),
        isActive: toOptionalBool(rows[i].isActive),
        studyPrices: [
          {
            price: toRequiredNumber(rows[i].price),
            stateId: 1, // Default to Jalisco
            showPrice: true,
          },
        ],
      };

      const dto = plainToInstance(CreateStudyDto, normalizedData, {
        enableImplicitConversion: true,
      });

      const errors = await validate(dto, { whitelist: true });

      if (errors.length) {
        invalid.push({
          row: initialRow,
          code: dto.code,
          errors: errors.flatMap((e) => Object.values(e.constraints ?? {})),
        });
      } else {
        valid.push({ ...dto, slug: normalizedData.slug });
      }
    }

    let processed = 0;
    const BATCH_SIZE = 50;
    const importErrors: Array<{ code: string; error: string }> = [];

    await this.prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < valid.length; i += BATCH_SIZE) {
          const batch = valid.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map(async (item) => {
              try {
                const { studyPrices, ...studyData } = item;

                // We use a custom upsert logic to handle prices
                const existingStudy = await tx.study.findUnique({
                  where: { code: item.code },
                });

                if (existingStudy) {
                  await tx.study.update({
                    where: { id: existingStudy.id },
                    data: {
                      ...studyData,
                      studyPrices: {
                        upsert: studyPrices.map((p) => ({
                          where: {
                            studyId_stateId: {
                              studyId: existingStudy.id,
                              stateId: p.stateId,
                            },
                          },
                          create: {
                            price: new Prisma.Decimal(p.price),
                            stateId: p.stateId,
                            showPrice: p.showPrice ?? true,
                          },
                          update: {
                            price: new Prisma.Decimal(p.price),
                            showPrice: p.showPrice ?? true,
                          },
                        })),
                      },
                    },
                  });
                } else {
                  await tx.study.create({
                    data: {
                      id: uuid(),
                      ...studyData,
                      studyPrices: {
                        create: studyPrices.map((p) => ({
                          price: new Prisma.Decimal(p.price),
                          stateId: p.stateId,
                          showPrice: p.showPrice ?? true,
                        })),
                      },
                    },
                  });
                }
                processed++;
              } catch (error) {
                importErrors.push({ code: item.code, error: error?.message });
                throw error;
              }
            }),
          );
        }
      },
      {
        timeout: 60000,
      },
    );

    return {
      sheetName,
      totalRows: rows.length,
      validRows: valid.length,
      processed,
      invalid,
      importErrors: importErrors.length > 0 ? importErrors : undefined,
    };
  }
}
