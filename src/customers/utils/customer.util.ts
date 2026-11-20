import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CustomerResponseDto } from '../dto/customer-response.dto';

export const CUSTOMER_INCLUDE = {
  priceSheet: { select: { id: true, name: true, isActive: true } },
} as const satisfies Prisma.CustomerInclude;

export type CustomerWithPriceSheet = Prisma.CustomerGetPayload<{
  include: typeof CUSTOMER_INCLUDE;
}>;

export interface PaymentMode {
  accountsReceivable: boolean;
  liquidate: boolean;
}

const DEFAULT_PAYMENT_MODE: PaymentMode = {
  accountsReceivable: false,
  liquidate: true,
};

/**
 * Resuelve la modalidad de pago (CxC XOR liquida al instante). Si solo llega
 * uno, el otro es su contrario; si no llega ninguno se conserva `current`.
 */
export function resolvePaymentMode(
  input: Partial<PaymentMode>,
  current: PaymentMode = DEFAULT_PAYMENT_MODE,
): PaymentMode {
  const { accountsReceivable, liquidate } = input;

  if (accountsReceivable === undefined && liquidate === undefined) {
    return {
      accountsReceivable: current.accountsReceivable,
      liquidate: current.liquidate,
    };
  }
  if (accountsReceivable !== undefined && liquidate !== undefined) {
    if (accountsReceivable === liquidate) {
      throw new BadRequestException(
        accountsReceivable
          ? 'Un cliente con cuenta por cobrar no puede liquidar al instante: elige solo una modalidad de pago'
          : 'El cliente debe generar cuenta por cobrar o liquidar al instante',
      );
    }
    return { accountsReceivable, liquidate };
  }
  if (accountsReceivable !== undefined) {
    return { accountsReceivable, liquidate: !accountsReceivable };
  }
  return { accountsReceivable: !liquidate, liquidate: liquidate as boolean };
}

/** 'YYYY-MM-DD' → Date a medianoche UTC (columna DATE, sin corrimiento de día). */
export function toDateOnly(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function assertValidPeriod(
  start: Date | null | undefined,
  end: Date | null | undefined,
) {
  if (start && end && end < start) {
    throw new BadRequestException(
      'La fecha de fin no puede ser anterior a la fecha de inicio',
    );
  }
}

const toNumber = (value: Prisma.Decimal | null) =>
  value === null ? null : Number(value);

export function toCustomerResponse(
  customer: CustomerWithPriceSheet,
): CustomerResponseDto {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    accountsReceivable: customer.accountsReceivable,
    liquidate: customer.liquidate,
    isActive: customer.isActive,
    contractAmount: toNumber(customer.contractAmount),
    patientAmount: toNumber(customer.patientAmount),
    startDate: formatDateOnly(customer.startDate),
    endDate: formatDateOnly(customer.endDate),
    priceSheetId: customer.priceSheetId,
    priceSheet: customer.priceSheet,
    branchId: customer.branchId,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}
