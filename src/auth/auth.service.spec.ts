import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { MailService } from 'src/mail/mail.service';
import { AuthService } from './auth.service';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let mailService: { sendOtpEmail: jest.Mock };
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    passwordResetToken: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  let passwordHash: string;

  const storedUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'ana@dyra.com',
    name: 'Ana',
    password: passwordHash,
    isActive: true,
    role: { id: 'role-1', name: 'Usuario', description: null },
    branches: [],
    ...overrides,
  });

  const otpToken = (overrides: Record<string, unknown> = {}) => ({
    id: 'otp-1',
    email: 'ana@dyra.com',
    otp: sha256('123456'),
    attempts: 0,
    used: false,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('secret123', 4);
  });

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      passwordResetToken: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    mailService = { sendOtpEmail: jest.fn() };
    jwtService = new JwtService({ secret: 'test-secret' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('returns an access token and the user without password', async () => {
      prisma.user.findUnique.mockResolvedValue(storedUser());

      const result = await service.login({
        email: 'ana@dyra.com',
        password: 'secret123',
      });

      expect(result.user).not.toHaveProperty('password');
      expect(result.user.email).toBe('ana@dyra.com');
      expect(jwtService.verify(result.access_token)).toMatchObject({
        sub: 'user-1',
        email: 'ana@dyra.com',
      });
    });

    it('uses the same generic message for unknown email and wrong password', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.login({ email: 'x@dyra.com', password: 'secret123' }),
      ).rejects.toThrow(new UnauthorizedException('Credenciales inválidas'));

      prisma.user.findUnique.mockResolvedValueOnce(storedUser());
      await expect(
        service.login({ email: 'ana@dyra.com', password: 'wrong-pass' }),
      ).rejects.toThrow(new UnauthorizedException('Credenciales inválidas'));
    });

    it('only reports an inactive account after a valid password', async () => {
      prisma.user.findUnique.mockResolvedValue(storedUser({ isActive: false }));

      await expect(
        service.login({ email: 'ana@dyra.com', password: 'wrong-pass' }),
      ).rejects.toThrow(new UnauthorizedException('Credenciales inválidas'));
      await expect(
        service.login({ email: 'ana@dyra.com', password: 'secret123' }),
      ).rejects.toThrow(new UnauthorizedException('Cuenta inactiva'));
    });
  });

  describe('forgotPassword', () => {
    const message =
      'Si el correo está registrado, recibirás el código en breve';

    it('stores a hashed 6-digit OTP and emails the plain one', async () => {
      prisma.user.findUnique.mockResolvedValue({ isActive: true });

      await expect(
        service.forgotPassword({ email: 'ana@dyra.com' }),
      ).resolves.toEqual({ message });

      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { email: 'ana@dyra.com' },
      });
      const sentOtp = mailService.sendOtpEmail.mock.calls[0][1] as string;
      expect(sentOtp).toMatch(/^\d{6}$/);
      const { data } = prisma.passwordResetToken.create.mock.calls[0][0] as {
        data: { otp: string; expiresAt: Date };
      };
      expect(data.otp).toBe(sha256(sentOtp));
      expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it.each([
      ['unknown', null],
      ['inactive', { isActive: false }],
    ])(
      'answers identically and sends nothing for an %s user',
      async (_, user) => {
        prisma.user.findUnique.mockResolvedValue(user);

        await expect(
          service.forgotPassword({ email: 'ana@dyra.com' }),
        ).resolves.toEqual({ message });
        expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
        expect(mailService.sendOtpEmail).not.toHaveBeenCalled();
      },
    );
  });

  describe('verifyOtp', () => {
    it('returns a password-reset token for a valid OTP and burns the OTP', async () => {
      prisma.passwordResetToken.findFirst.mockResolvedValue(otpToken());
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isActive: true,
      });

      const { resetToken } = await service.verifyOtp({
        email: 'ana@dyra.com',
        otp: '123456',
      });

      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { used: true },
      });
      expect(jwtService.verify(resetToken)).toMatchObject({
        sub: 'user-1',
        type: 'password_reset',
      });
    });

    it('rejects when there is no valid (unused, unexpired) OTP', async () => {
      prisma.passwordResetToken.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyOtp({ email: 'ana@dyra.com', otp: '123456' }),
      ).rejects.toThrow(
        new UnauthorizedException('Código inválido o expirado'),
      );
    });

    it('counts a wrong OTP as a failed attempt', async () => {
      prisma.passwordResetToken.findFirst.mockResolvedValue(otpToken());

      await expect(
        service.verifyOtp({ email: 'ana@dyra.com', otp: '000000' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { attempts: 1, used: false },
      });
    });

    it('invalidates the OTP on the 5th failed attempt', async () => {
      prisma.passwordResetToken.findFirst.mockResolvedValue(
        otpToken({ attempts: 4 }),
      );

      await expect(
        service.verifyOtp({ email: 'ana@dyra.com', otp: '000000' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { attempts: 5, used: true },
      });
    });
  });

  describe('resetPassword', () => {
    const resetTokenFor = (type?: string) =>
      jwtService.sign({ sub: 'user-1', email: 'ana@dyra.com', type });

    it('updates the password and deletes remaining OTPs of the email', async () => {
      prisma.user.findUnique.mockResolvedValue({ isActive: true });

      await expect(
        service.resetPassword({
          resetToken: resetTokenFor('password_reset'),
          newPassword: 'nueva123',
        }),
      ).resolves.toEqual({ message: 'Contraseña actualizada exitosamente' });

      const { data } = prisma.user.update.mock.calls[0][0] as {
        data: { password: string };
      };
      await expect(bcrypt.compare('nueva123', data.password)).resolves.toBe(
        true,
      );
      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { email: 'ana@dyra.com' },
      });
    });

    it('rejects an access token used as reset token', async () => {
      await expect(
        service.resetPassword({
          resetToken: resetTokenFor(),
          newPassword: 'nueva123',
        }),
      ).rejects.toThrow(new UnauthorizedException('Token inválido'));
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an invalid or expired token', async () => {
      await expect(
        service.resetPassword({
          resetToken: 'garbage',
          newPassword: 'x1234567',
        }),
      ).rejects.toThrow(new UnauthorizedException('Token inválido o expirado'));
    });
  });

  describe('changePassword', () => {
    it('rejects a wrong current password', async () => {
      prisma.user.findUnique.mockResolvedValue(storedUser());

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'wrong-pass',
          newPassword: 'nueva123',
        }),
      ).rejects.toThrow(
        new UnauthorizedException('La contraseña actual es incorrecta'),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('stores the new password hashed', async () => {
      prisma.user.findUnique.mockResolvedValue(storedUser());

      await service.changePassword('user-1', {
        currentPassword: 'secret123',
        newPassword: 'nueva123',
      });

      const { data } = prisma.user.update.mock.calls[0][0] as {
        data: { password: string };
      };
      await expect(bcrypt.compare('nueva123', data.password)).resolves.toBe(
        true,
      );
    });
  });
});
