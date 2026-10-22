import {
  BadRequestException,
  ConflictException,
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
import {
  SUBCATEGORY_FORM_TYPES,
  TICKET_FORM_DEFINITIONS,
} from '../forms/ticket-forms.const';
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
    await this.assertFormTypeUnchangedWhileInUse(current, dto);

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
    if (
      !SUBCATEGORY_FORM_TYPES.includes(formType) ||
      definition.category !== category
    ) {
      throw new BadRequestException(
        `El formulario "${definition.label}" no se asigna por subcategoría en la categoría ${category}`,
      );
    }
  }

  /**
   * Tickets already carry the form their subcategory asked for: changing the
   * category or form of a subcategory in use would leave them inconsistent.
   */
  private async assertFormTypeUnchangedWhileInUse(
    current: {
      id: string;
      category: Category;
      formType: TicketFormType | null;
    },
    dto: UpdateTicketSubcategoryDto,
  ) {
    const changesFormType =
      dto.formType !== undefined && (dto.formType ?? null) !== current.formType;
    const changesCategory =
      dto.category !== undefined && dto.category !== current.category;
    if (!changesFormType && !changesCategory) return;

    const inUse = await this.prisma.ticket.count({
      where: { subcategoryId: current.id },
    });
    if (inUse > 0) {
      throw new ConflictException(
        `La subcategoría tiene ${inUse} ticket(s): no se puede cambiar su categoría ni su formulario. Desactívala y crea una nueva.`,
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
