import { Prisma, TicketFormType } from '@prisma/client';
import { ClassConstructor } from 'class-transformer';

export interface TicketFormContext {
  branchId: string;
}

export interface TicketFormApplyResult {
  result: Prisma.InputJsonObject;
  summary: string;
}

export interface TicketFormHandler<
  TData extends object,
  TApply extends object,
> {
  readonly type: TicketFormType;
  readonly dataDto: ClassConstructor<TData>;
  readonly applyDto: ClassConstructor<TApply>;

  assertValid(data: TData, context: TicketFormContext): Promise<void>;

  apply(
    data: TData,
    applyData: TApply,
    context: TicketFormContext,
  ): Promise<TicketFormApplyResult>;
}
