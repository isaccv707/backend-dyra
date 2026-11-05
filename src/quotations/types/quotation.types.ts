import { Prisma, Quotation, QuotationItem } from '@prisma/client';
import { PanelComponentSnapshot } from 'src/studies/utils/panel-tree.util';
import { QUOTATION_BRANCH_SELECT } from '../constants/quotation-query.const';

export type QuotationBranch = Prisma.BranchGetPayload<{
  select: typeof QUOTATION_BRANCH_SELECT;
}>;

export type QuotationWithItems = Quotation & {
  items: QuotationItem[];
  branch: QuotationBranch;
  priceSheet?: { id: string; name: string } | null;
};

export type ResolvedQuotationItem = {
  name: string;
  code: string | null;
  price: number;
  quantity: number;
  studyId: string | null;
  components?: PanelComponentSnapshot[];
};
