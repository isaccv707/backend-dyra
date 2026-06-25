import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow<string>('MAIL_HOST'),
      port: this.configService.getOrThrow<number>('MAIL_PORT'),
      secure: false,
      auth: {
        user: this.configService.getOrThrow<string>('MAIL_USER'),
        pass: this.configService.getOrThrow<string>('MAIL_PASS'),
      },
    });
  }

  async sendOtpEmail(to: string, otp: string): Promise<void> {
    const from = this.configService.getOrThrow<string>('MAIL_FROM');

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: 'Código de recuperación de contraseña — DYRA Analítica',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #f9f9f9; border-radius: 8px;">
            <h2 style="color: #1a1a2e; margin-bottom: 8px;">Recuperación de contraseña</h2>
            <p style="color: #444; margin-bottom: 24px;">
              Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en <strong>DYRA Analítica</strong>.
              Usa el siguiente código de verificación:
            </p>
            <div style="background: #ffffff; border: 2px solid #e0e0e0; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
              <span style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #1a1a2e;">${otp}</span>
            </div>
            <p style="color: #666; font-size: 14px;">
              Este código es válido por <strong>15 minutos</strong> y solo puede usarse una vez.<br/>
              Si no solicitaste este cambio, puedes ignorar este correo.
            </p>
            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />
            <p style="color: #999; font-size: 12px; text-align: center;">
              DYRA Analítica — No respondas a este correo automático.
            </p>
          </div>
        `,
      });
    } catch {
      throw new InternalServerErrorException('No se pudo enviar el correo de verificación');
    }
  }
}
