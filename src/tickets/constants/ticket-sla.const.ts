import { TicketPriority } from '@prisma/client';

// Horas objetivo de resolución por prioridad — usadas por TicketsService
// para calcular Ticket.dueAt al crear el ticket o al cambiar su prioridad,
// y por TicketsSlaService para decidir qué tickets están vencidos. Son un
// valor por defecto razonable, no una política contractual con el cliente;
// ajustar aquí si el negocio define otros tiempos.
export const SLA_HOURS_BY_PRIORITY: Record<TicketPriority, number> = {
  CRITICAL: 4,
  HIGH: 8,
  MEDIUM: 24,
  LOW: 72,
};

export function computeDueAt(priority: TicketPriority, from: Date): Date {
  const hours = SLA_HOURS_BY_PRIORITY[priority];
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}
