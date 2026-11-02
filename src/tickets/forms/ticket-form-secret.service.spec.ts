import { TicketFormSecretService } from './ticket-form-secret.service';

const KEY = Buffer.alloc(32, 1).toString('base64');

describe('TicketFormSecretService', () => {
  const service = new TicketFormSecretService();
  const originalKey = process.env.TICKET_SECRET_KEY;

  beforeEach(() => {
    process.env.TICKET_SECRET_KEY = KEY;
  });

  afterAll(() => {
    process.env.TICKET_SECRET_KEY = originalKey;
  });

  it('descifra lo que cifró, sin dejar el texto a la vista', () => {
    const stored = service.encrypt('contraseña-ñ-123');

    expect(stored).not.toContain('contraseña');
    expect(service.decrypt(stored)).toBe('contraseña-ñ-123');
  });

  it('cifrar lo mismo dos veces da resultados distintos', () => {
    expect(service.encrypt('abc')).not.toBe(service.encrypt('abc'));
  });

  it('rechaza un valor alterado', () => {
    const [version, iv, tag, encrypted] = service.encrypt('abc').split(':');
    const altered = Buffer.from(encrypted, 'base64');
    altered[0] ^= 1;

    expect(() =>
      service.decrypt([version, iv, tag, altered.toString('base64')].join(':')),
    ).toThrow();
  });

  it('no descifra con otra llave', () => {
    const stored = service.encrypt('abc');
    process.env.TICKET_SECRET_KEY = Buffer.alloc(32, 2).toString('base64');

    expect(() => service.decrypt(stored)).toThrow();
  });

  it.each([undefined, '', 'corta'])(
    'no arranca con la llave inválida %s',
    (key) => {
      if (key === undefined) delete process.env.TICKET_SECRET_KEY;
      else process.env.TICKET_SECRET_KEY = key;

      expect(() => service.onModuleInit()).toThrow('TICKET_SECRET_KEY');
    },
  );
});
