/** Share of the SLA used when the "about to expire" notice goes out. */
export const SLA_WARNING_RATIO = 0.75;

/** Business hours an overdue ticket may stay unassigned before escalating. */
export const ESCALATION_BUSINESS_HOURS = Number(
  process.env.TICKET_ESCALATION_HOURS ?? 2,
);

/** Role that receives escalations (global or of the ticket's branch). */
export const ESCALATION_ROLE = 'Administrador';

/** Business days a RESOLVED ticket waits for the requester before closing. */
export const AUTO_CLOSE_BUSINESS_DAYS = Number(
  process.env.TICKET_AUTO_CLOSE_DAYS ?? 3,
);
