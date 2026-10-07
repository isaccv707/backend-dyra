import { Category, TicketFormType } from '@prisma/client';

export const TICKET_FORM_DEFINITIONS: Record<
  TicketFormType,
  { category: Category; label: string }
> = {
  STUDY_CREATE: { category: 'COGNITI', label: 'Alta de parámetro' },
  STUDY_UPDATE: { category: 'COGNITI', label: 'Actualización de parámetro' },
};
