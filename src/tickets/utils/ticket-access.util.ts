import { ForbiddenException } from '@nestjs/common';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import { TICKET_UPDATE_PERMISSION } from '../tickets.shared';

export const hasTicketUpdatePermission = (user: RequestUser): boolean =>
  user.role.permissions.includes(TICKET_UPDATE_PERMISSION);

/**
 * TI (tickets:update) reaches every ticket of its branches; anyone else only
 * the ones they created or are assigned to, regardless of branch. Returns
 * whether the user is TI.
 */
export function assertTicketAccess(
  ticket: { branchId: string; createdById: string },
  assigneeIds: string[],
  user: RequestUser,
): boolean {
  const canSeeAllTickets = hasTicketUpdatePermission(user);

  if (canSeeAllTickets) {
    assertBranchAccess(user, ticket.branchId);
  } else if (ticket.createdById !== user.id && !assigneeIds.includes(user.id)) {
    throw new ForbiddenException('No tienes acceso a este ticket');
  }

  return canSeeAllTickets;
}
