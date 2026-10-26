import {
  addBusinessDays,
  addBusinessTime,
  businessTimeBetween,
} from './business-hours';
import { computeDueAt } from './ticket-sla.const';

// America/Mexico_City is UTC-6 all year (no daylight saving since 2022).
const mx = (iso: string) => new Date(`${iso}-06:00`);
const HOUR = 60 * 60 * 1000;

describe('business hours (L–V 9–17, sáb 9–14, dom cerrado)', () => {
  it('suma dentro del mismo día hábil', () => {
    // Martes 21/10/2026 10:00 + 4 h = 14:00
    expect(addBusinessTime(mx('2026-10-21T10:00:00'), 4 * HOUR)).toEqual(
      mx('2026-10-21T14:00:00'),
    );
  });

  it('pasa al día siguiente al cerrar a las 17:00', () => {
    // Martes 15:00 + 4 h = 2 h el martes + 2 h el miércoles → 11:00
    expect(addBusinessTime(mx('2026-10-21T15:00:00'), 4 * HOUR)).toEqual(
      mx('2026-10-22T11:00:00'),
    );
  });

  it('fuera de horario empieza a contar al abrir', () => {
    // Martes 20:00 + 1 h → miércoles 10:00
    expect(addBusinessTime(mx('2026-10-21T20:00:00'), HOUR)).toEqual(
      mx('2026-10-22T10:00:00'),
    );
  });

  it('el sábado cierra a las 14:00 y el domingo no cuenta', () => {
    // Sábado 13:00 + 3 h = 1 h el sábado + 2 h el lunes → lunes 11:00
    expect(addBusinessTime(mx('2026-10-24T13:00:00'), 3 * HOUR)).toEqual(
      mx('2026-10-26T11:00:00'),
    );
  });

  it('mide solo el tiempo hábil entre dos instantes', () => {
    // Viernes 16:00 → lunes 10:00 = 1 h viernes + 5 h sábado + 1 h lunes
    expect(
      businessTimeBetween(mx('2026-10-23T16:00:00'), mx('2026-10-26T10:00:00')),
    ).toBe(7 * HOUR);
  });

  it('el SLA de 24 h (media) son tres días hábiles completos', () => {
    // Lunes 9:00 + 24 h hábiles = lunes, martes, miércoles → miércoles 17:00
    expect(computeDueAt('MEDIUM', mx('2026-10-19T09:00:00'))).toEqual(
      mx('2026-10-21T17:00:00'),
    );
  });

  it('suma el tiempo pausado al vencimiento', () => {
    expect(computeDueAt('CRITICAL', mx('2026-10-21T09:00:00'), HOUR)).toEqual(
      mx('2026-10-21T14:00:00'),
    );
  });

  describe('addBusinessDays', () => {
    it('cuenta el sábado como día hábil y salta el domingo', () => {
      // Viernes 23/10 10:00 + 3 días hábiles: sábado, lunes, martes
      expect(addBusinessDays(mx('2026-10-23T10:00:00'), 3)).toEqual(
        mx('2026-10-27T10:00:00'),
      );
    });

    it('conserva la hora local', () => {
      expect(addBusinessDays(mx('2026-10-22T16:45:30'), 1)).toEqual(
        mx('2026-10-23T16:45:30'),
      );
    });
  });
});
