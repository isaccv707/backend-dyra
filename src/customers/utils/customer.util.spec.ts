import { BadRequestException } from '@nestjs/common';
import {
  assertValidPeriod,
  formatDateOnly,
  resolvePaymentMode,
  toDateOnly,
} from './customer.util';

describe('resolvePaymentMode', () => {
  it('sin datos: el cliente liquida', () => {
    expect(resolvePaymentMode({})).toEqual({
      accountsReceivable: false,
      liquidate: true,
    });
  });

  it('accountsReceivable=true implica que no liquida', () => {
    expect(resolvePaymentMode({ accountsReceivable: true })).toEqual({
      accountsReceivable: true,
      liquidate: false,
    });
  });

  it('liquidate=true implica que no genera CxC', () => {
    expect(
      resolvePaymentMode(
        { liquidate: true },
        { accountsReceivable: true, liquidate: false },
      ),
    ).toEqual({ accountsReceivable: false, liquidate: true });
  });

  it('liquidate=false implica CxC', () => {
    expect(resolvePaymentMode({ liquidate: false })).toEqual({
      accountsReceivable: true,
      liquidate: false,
    });
  });

  it('conserva la modalidad actual si no llega ninguno', () => {
    const current = { accountsReceivable: true, liquidate: false };
    expect(resolvePaymentMode({}, current)).toEqual(current);
  });

  it('solo devuelve los dos campos aunque reciba el registro completo', () => {
    const record = {
      id: 'x',
      name: 'Y',
      accountsReceivable: true,
      liquidate: false,
    };
    expect(resolvePaymentMode({}, record)).toStrictEqual({
      accountsReceivable: true,
      liquidate: false,
    });
  });

  it('rechaza ambos true', () => {
    expect(() =>
      resolvePaymentMode({ accountsReceivable: true, liquidate: true }),
    ).toThrow('no puede liquidar al instante');
  });

  it('rechaza ambos false', () => {
    expect(() =>
      resolvePaymentMode({ accountsReceivable: false, liquidate: false }),
    ).toThrow(BadRequestException);
  });
});

describe('fechas', () => {
  it('convierte YYYY-MM-DD a medianoche UTC y de regreso sin corrimiento', () => {
    const date = toDateOnly('2026-01-31');
    expect(date?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(formatDateOnly(date ?? null)).toBe('2026-01-31');
  });

  it('respeta undefined (no tocar) y null (limpiar)', () => {
    expect(toDateOnly(undefined)).toBeUndefined();
    expect(toDateOnly(null)).toBeNull();
  });

  it('rechaza fin anterior al inicio y permite el mismo día', () => {
    expect(() =>
      assertValidPeriod(toDateOnly('2026-02-01'), toDateOnly('2026-01-31')),
    ).toThrow('anterior a la fecha de inicio');
    expect(() =>
      assertValidPeriod(toDateOnly('2026-02-01'), toDateOnly('2026-02-01')),
    ).not.toThrow();
  });
});
