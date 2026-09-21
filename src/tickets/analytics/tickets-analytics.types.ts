import { Category, TicketPriority, TicketStatus } from '@prisma/client';

export interface TicketAnalyticsSummary {
  total: number;
  byStatus: { status: TicketStatus; count: number }[];
  byPriority: { priority: TicketPriority; count: number }[];
  byCategory: { category: Category; count: number }[];
  avgFirstResponseSeconds: number | null;
  avgResolutionSeconds: number | null;
  reopenedCount: number;
  reopenedRate: number;
  overdueCount: number;
}

export interface TicketsByUserRow {
  userId: string;
  name: string;
  email: string | null;
  total: number;
  byStatus: { status: TicketStatus; count: number }[];
  avgResolutionSeconds: number | null;
}

export interface TicketsByAssigneeRow {
  assigneeId: string | null;
  name: string;
  total: number;
  reopenedCount: number;
  avgResolutionSeconds: number | null;
}

export interface TicketsByCategoryRow {
  category: Category;
  count: number;
  percentage: number;
  subcategories: {
    subcategoryId: string | null;
    name: string;
    count: number;
  }[];
}

export interface TicketTrendPoint {
  date: Date;
  count: number;
}

export interface TicketTrendResult {
  interval: string;
  created: TicketTrendPoint[];
  resolved: TicketTrendPoint[];
}
