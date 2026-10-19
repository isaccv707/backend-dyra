import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { MailService } from 'src/mail/mail.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  JwtPayload,
  PASSWORD_RESET_TOKEN_TYPE,
} from './interfaces/jwt-payload.interface';

const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const FORGOT_PASSWORD_MESSAGE =
  'Si el correo está registrado, recibirás el código en breve';

const hashOtp = (otp: string) => createHash('sha256').update(otp).digest('hex');

const otpMatches = (otp: string, storedHash: string) => {
  const candidate = Buffer.from(hashOtp(otp), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        isActive: true,
        role: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
        branches: {
          select: { id: true, name: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Checked after the password so it doesn't reveal which accounts exist.
    if (!user.isActive) {
      throw new UnauthorizedException('Cuenta inactiva');
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };

    const { password: _, ...userWithoutPassword } = user;

    return {
      access_token: this.jwtService.sign(payload),
      user: userWithoutPassword,
    };
  }

  async forgotPassword({ email }: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { isActive: true },
    });

    if (!user?.isActive) {
      return { message: FORGOT_PASSWORD_MESSAGE };
    }

    const otp = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.prisma.passwordResetToken.deleteMany({ where: { email } });

    await this.prisma.passwordResetToken.create({
      data: { email, otp: hashOtp(otp), expiresAt },
    });

    await this.mailService.sendOtpEmail(email, otp);

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async verifyOtp({ email, otp }: VerifyOtpDto) {
    const token = await this.prisma.passwordResetToken.findFirst({
      where: {
        email,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!token) {
      throw new UnauthorizedException('Código inválido o expirado');
    }

    if (!otpMatches(otp, token.otp)) {
      const attempts = token.attempts + 1;
      await this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { attempts, used: attempts >= OTP_MAX_ATTEMPTS },
      });
      throw new UnauthorizedException('Código inválido o expirado');
    }

    await this.prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { used: true },
    });

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, isActive: true },
    });
    if (!user?.isActive) {
      throw new UnauthorizedException('Código inválido o expirado');
    }

    const resetPayload: JwtPayload = {
      sub: user.id,
      email,
      type: PASSWORD_RESET_TOKEN_TYPE,
    };
    const resetToken = this.jwtService.sign(resetPayload, {
      expiresIn: '15m',
    });

    return { resetToken };
  }

  async resetPassword({ resetToken, newPassword }: ResetPasswordDto) {
    let payload: JwtPayload;

    try {
      payload = this.jwtService.verify<JwtPayload>(resetToken);
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    if (payload.type !== PASSWORD_RESET_TOKEN_TYPE) {
      throw new UnauthorizedException('Token inválido');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true },
    });
    if (!user?.isActive) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: payload.sub },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: { email: payload.email },
      }),
    ]);

    return { message: 'Contraseña actualizada exitosamente' };
  }

  async changePassword(
    userId: string,
    { currentPassword, newPassword }: ChangePasswordDto,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { message: 'Contraseña actualizada exitosamente' };
  }
}
