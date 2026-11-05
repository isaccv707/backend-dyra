import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category, Ticket, TicketFormType, TicketStatus } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { UpdateTicketDto } from '../dto/update-ticket.dto';
import {
  resolveFormType,
  SUBCATEGORY_FORM_CATEGORIES,
  TICKET_FORM_DEFINITIONS,
} from '../forms/ticket-forms.const';
import { CATEGORY_LABELS, TICKET_STATUS_LABELS } from '../tickets.shared';

const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'RESOLVED', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['IN_PROGRESS'],
  CANCELLED: [],
};

/** Status transitions and the category/subcategory/form a ticket may have. */
@Injectable()
export class TicketClassificationService {
  constructor(private readonly prisma: PrismaService) {}

  assertValidStatusTransition(from: TicketStatus, to: TicketStatus) {
    if (!TICKET_STATUS_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `No se puede cambiar el estado de "${TICKET_STATUS_LABELS[from]}" a "${TICKET_STATUS_LABELS[to]}"`,
      );
    }
  }

  async assertSubcategoryBelongsToCategory(
    subcategoryId: string,
    category: Category,
  ) {
    const subcategory = await this.prisma.ticketSubcategory.findUnique({
      where: { id: subcategoryId },
      select: { category: true, formType: true },
    });

    if (!subcategory) {
      throw new NotFoundException(
        `TicketSubcategory with ID '${subcategoryId}' not found`,
      );
    }
    if (subcategory.category !== category) {
      throw new BadRequestException(
        `La subcategoría no pertenece a la categoría '${category}'`,
      );
    }

    return subcategory;
  }

  /** Validates the subcategory and returns the form the ticket must carry. */
  async resolveTicketFormType(
    category: Category,
    subcategoryId: string | null | undefined,
  ): Promise<TicketFormType | null> {
    if (!subcategoryId && SUBCATEGORY_FORM_CATEGORIES.includes(category)) {
      throw new BadRequestException(
        `subcategoryId es requerido para la categoría ${CATEGORY_LABELS[category]}`,
      );
    }
    const subcategory = subcategoryId
      ? await this.assertSubcategoryBelongsToCategory(subcategoryId, category)
      : null;
    return resolveFormType(category, subcategory?.formType);
  }

  /** A ticket keeps its form: it can only move where the same form applies. */
  async assertFormKeptOnReclassify(
    ticket: Pick<Ticket, 'category' | 'subcategoryId'> & {
      form: { type: TicketFormType } | null;
    },
    dto: UpdateTicketDto,
  ) {
    const category = dto.category ?? ticket.category;
    const subcategoryId =
      dto.subcategoryId !== undefined
        ? dto.subcategoryId
        : ticket.subcategoryId;
    if (
      category === ticket.category &&
      subcategoryId === ticket.subcategoryId
    ) {
      return;
    }

    const currentFormType = ticket.form?.type ?? null;
    const newFormType = await this.resolveTicketFormType(
      category,
      subcategoryId,
    );
    if (newFormType !== currentFormType) {
      throw new BadRequestException(
        currentFormType
          ? `El ticket tiene un formulario de "${TICKET_FORM_DEFINITIONS[currentFormType].label}": solo puede reclasificarse donde aplique ese mismo formulario`
          : 'La nueva clasificación requiere un formulario: crea un ticket nuevo en esa categoría',
      );
    }
  }
}
