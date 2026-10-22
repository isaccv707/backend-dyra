import { Prisma, TicketFormType } from '@prisma/client';
import { ClassConstructor } from 'class-transformer';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';

export type TicketFormDb = Prisma.TransactionClient;

export interface TicketFormContext {
  /** Branch of the ticket. */
  branchId: string;
  /** Requester when validating; approver when applying. */
  actor: RequestUser;
  /** request: creating or editing the ticket; apply: IT approving it. */
  phase: 'request' | 'apply';
}

export interface TicketFormValidation {
  /** Ticket title generated from the form; undefined = the requester writes it. */
  title?: string;
  /** Server-set fields merged into the stored data (they replace the client's). */
  data?: Prisma.InputJsonObject;
}

export interface TicketFormApplyResult {
  result: Prisma.InputJsonObject;
  /** Completes "aprobó la solicitud y …" in the system comment. */
  summary: string;
  /**
   * Side effect run after the commit without blocking the response (e.g. an
   * email); what it returns is merged into form.result.
   */
  afterCommit?: () => Promise<Prisma.InputJsonObject | void>;
}

export interface TicketFormHandler<
  TData extends object = object,
  TApply extends object = object,
> {
  readonly type: TicketFormType;
  readonly dataDto: ClassConstructor<TData>;
  /** Data IT captures when approving; absent = the form is informative only. */
  readonly applyDto?: ClassConstructor<TApply>;

  validate(
    data: TData,
    context: TicketFormContext,
    db: TicketFormDb,
  ): Promise<TicketFormValidation>;

  apply?(
    data: TData,
    applyData: TApply,
    context: TicketFormContext,
    tx: TicketFormDb,
  ): Promise<TicketFormApplyResult>;
}
