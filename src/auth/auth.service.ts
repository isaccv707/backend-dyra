import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { MailService } from 'src/mail/mail.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

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
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account is inactive');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };

    const { password: _, ...userWithoutPassword } = user;

    return {
      access_token: this.jwtService.sign(payload),
      user: userWithoutPassword,
    };
  }

  async forgotPassword({ email }: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      return { message: 'Si el correo está registrado, recibirás el código en breve' };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.passwordResetToken.deleteMany({ where: { email } });

    await this.prisma.passwordResetToken.create({
      data: { email, otp, expiresAt },
    });

    await this.mailService.sendOtpEmail(email, otp);

    return { message: 'Si el correo está registrado, recibirás el código en breve' };
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

    if (!token || token.otp !== otp) {
      throw new UnauthorizedException('Código inválido o expirado');
    }

    await this.prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { used: true },
    });

    const user = await this.prisma.user.findUnique({ where: { email } });

    const resetToken = this.jwtService.sign(
      { sub: user!.id, email, type: 'password_reset' },
      { expiresIn: '15m' },
    );

    return { resetToken };
  }

  async resetPassword({ resetToken, newPassword }: ResetPasswordDto) {
    let payload: { sub: string; email: string; type: string };

    try {
      payload = this.jwtService.verify(resetToken);
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    if (payload.type !== 'password_reset') {
      throw new UnauthorizedException('Token inválido');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: payload.sub },
      data: { password: hashedPassword },
    });

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
