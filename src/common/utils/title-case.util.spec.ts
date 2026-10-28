import { toTitleCase } from './title-case.util';

describe('toTitleCase', () => {
  it.each([
    ['hemoglobina glicosilada', 'Hemoglobina Glicosilada'],
    ['HEMOGLOBINA GLICOSILADA', 'Hemoglobina Glicosilada'],
    ['hEmOgLoBiNa   glicosilada ', 'Hemoglobina Glicosilada'],
    ['ácido úrico en orina de 24 horas', 'Ácido Úrico En Orina De 24 Horas'],
    ['biometría hemática (bh)', 'Biometría Hemática (Bh)'],
    ['anti-hiv 1/2', 'Anti-Hiv 1/2'],
    ['vitamina b12', 'Vitamina B12'],
    ['ñandú', 'Ñandú'],
  ])('%p -> %p', (input, expected) => {
    expect(toTitleCase(input)).toBe(expected);
  });
});
