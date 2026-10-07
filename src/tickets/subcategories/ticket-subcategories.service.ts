import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import { Category, Prisma, TicketFormType } from '@prisma/client';
import { TICKET_FORM_DEFINITIONS } from '../forms/ticket-forms.const';
import { CreateTicketSubcategoryDto } from './dto/create-ticket-subcategory.dto';
import { UpdateTicketSubcategoryDto } from './dto/update-ticket-subcategory.dto';
import { FindTicketSubcategoriesDto } from './dto/find-ticket-subcategories.dto';

@Injectable()
export class TicketSubcategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTicketSubcategoryDto) {
    this.assertFormTypeMatchesCategory(dto.formType, dto.category);

    try {
      return await this.prisma.ticketSubcategory.create({ data: dto });
    } catch (error) {
      handleDatabaseErrors(error, 'TicketSubcategory');
    }
  }

  async findAll(dto: FindTicketSubcategoriesDto) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name'],
      defaultSort: { category: 'asc' },
      allowedFields: ['category', 'name', 'isActive', 'createdAt'],
    });

    const finalWhere = {
      ...where,
      ...(dto.category && { category: dto.category }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    } as Prisma.TicketSubcategoryWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.ticketSubcategory.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
      }),
      this.prisma.ticketSubcategory.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async update(id: string, dto: UpdateTicketSubcategoryDto) {
    const current = await this.assertExists(id);
    this.assertFormTypeMatchesCategory(
      dto.formType !== undefined ? dto.formType : current.formType,
      dto.category ?? current.category,
    );

    try {
      return await this.prisma.ticketSubcategory.update({
        where: { id },
        data: dto,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'TicketSubcategory');
    }
  }

  async remove(id: string) {
    await this.assertExists(id);

    try {
      return await this.prisma.ticketSubcategory.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, 'TicketSubcategory');
    }
  }

  private assertFormTypeMatchesCategory(
    formType: TicketFormType | null | undefined,
    category: Category,
  ) {
    if (!formType) return;

    const definition = TICKET_FORM_DEFINITIONS[formType];
    if (definition.category !== category) {
      throw new BadRequestException(
        `El formulario "${definition.label}" solo aplica a la categoría ${definition.category}`,
      );
    }
  }

  private async assertExists(id: string) {
    const subcategory = await this.prisma.ticketSubcategory.findUnique({
      where: { id },
    });
    if (!subcategory) {
      throw new NotFoundException(
        `TicketSubcategory with ID '${id}' not found`,
      );
    }
    return subcategory;
  }
}
