import {
  ContactMessageStatus,
  ContactMessageSubject,
  Prisma,
} from '@prisma/client';

/** Users with this permission manage the messages and receive the email notice. */
export const CONTACT_MESSAGES_UPDATE_PERMISSION = 'contact-messages:update';

export const CONTACT_SUBJECT_LABELS: Record<ContactMessageSubject, string> = {
  CLINICAL_ANALYSIS: 'Análisis clínicos',
  CORPORATE_HEALTH: 'Salud empresarial',
  HOME_SAMPLING: 'Tomas a domicilio',
  OTHER: 'Otro',
};

export const CONTACT_STATUS_LABELS: Record<ContactMessageStatus, string> = {
  NEW: 'Nuevo',
  IN_PROGRESS: 'En proceso',
  RESOLVED: 'Atendido',
  DISCARDED: 'Descartado',
};

const branchRef = { select: { id: true, name: true } } as const;

/** List rows: everything but the status history. */
export const contactMessageListInclude = {
  branch: branchRef,
} satisfies Prisma.ContactMessageInclude;

/** Detail: + history (oldest first) with who made each change. */
export const contactMessageDetailInclude = {
  branch: branchRef,
  history: {
    orderBy: { createdAt: 'asc' },
    include: { changedBy: { select: { id: true, name: true } } },
  },
} satisfies Prisma.ContactMessageInclude;
