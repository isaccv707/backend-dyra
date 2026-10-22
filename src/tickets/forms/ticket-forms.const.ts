import { Category, TicketFormType } from '@prisma/client';

/**
 * `version` is the current shape of each form's data. When a DTO changes in a
 * way old data no longer validates, bump it and add the upgrade step to
 * TICKET_FORM_UPGRADES so pending requests keep working.
 */
export const TICKET_FORM_DEFINITIONS: Record<
  TicketFormType,
  {
    label: string;
    version: number;
    /** Category whose subcategories may declare this form (COGNITI) or that always uses it. */
    category: Category;
    /** Permission the approver needs besides tickets:update; null = no apply. */
    applyPermission: string | null;
  }
> = {
  SOFTWARE_REMOTE: {
    version: 1,
    label: 'Soporte de software',
    category: 'SOFTWARE',
    applyPermission: null,
  },
  ACCESS_REQUEST: {
    version: 1,
    label: 'Solicitud de acceso',
    category: 'ACCESS',
    applyPermission: 'users:create',
  },
  STUDY_CREATE: {
    version: 1,
    label: 'Alta de parámetro',
    category: 'COGNITI',
    applyPermission: 'studies:create',
  },
  STUDY_UPDATE: {
    version: 1,
    label: 'Actualización de parámetro',
    category: 'COGNITI',
    applyPermission: 'studies:update',
  },
  CLIENT_CREATE: {
    version: 1,
    label: 'Alta de cliente',
    category: 'COGNITI',
    applyPermission: null,
  },
};

/** Categories whose form doesn't depend on the subcategory. */
const CATEGORY_FORM_TYPES: Partial<Record<Category, TicketFormType>> = {
  SOFTWARE: 'SOFTWARE_REMOTE',
  ACCESS: 'ACCESS_REQUEST',
};

/** Categories where the form comes from the subcategory, so one is required. */
export const SUBCATEGORY_FORM_CATEGORIES: Category[] = ['COGNITI'];

/** Forms that may only be declared by a subcategory. */
export const SUBCATEGORY_FORM_TYPES: TicketFormType[] = [
  'STUDY_CREATE',
  'STUDY_UPDATE',
  'CLIENT_CREATE',
];

export function resolveFormType(
  category: Category,
  subcategoryFormType: TicketFormType | null | undefined,
): TicketFormType | null {
  return CATEGORY_FORM_TYPES[category] ?? subcategoryFormType ?? null;
}

export const TICKET_TITLE_MAX_LENGTH = 200;

export const ticketTitle = (prefix: string, subject: string) =>
  `${prefix}: ${subject}`.slice(0, TICKET_TITLE_MAX_LENGTH);

/**
 * Roles with permissions over these modules are never offered nor accepted in
 * an access request (privilege escalation through a ticket).
 */
export const PRIVILEGED_PERMISSION_MODULES = ['users', 'roles', 'permissions'];

export const isPrivilegedPermission = (action: string) =>
  PRIVILEGED_PERMISSION_MODULES.some((module) =>
    action.startsWith(`${module}:`),
  );

type FormData = Record<string, unknown>;

/**
 * Upgrade steps per form type: `[n]` turns data of version n into version n+1.
 * Empty while every form is at version 1.
 */
export const TICKET_FORM_UPGRADES: Partial<
  Record<TicketFormType, Record<number, (data: FormData) => FormData>>
> = {};
