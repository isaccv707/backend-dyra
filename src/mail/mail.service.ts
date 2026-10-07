import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

const DEFAULT_ADMIN_APP_URL = 'https://admin.dyranalitica.com';

export interface TicketAssignedEmailData {
  ticketId: string;
  code: number;
  title: string;
  priorityLabel: string;
  branchName: string;
  assignedByName: string;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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
      throw new InternalServerErrorException(
        'No se pudo enviar el correo de verificación',
      );
    }
  }

  async sendTicketAssignedEmail(
    to: string,
    data: TicketAssignedEmailData,
  ): Promise<void> {
    const from = this.configService.getOrThrow<string>('MAIL_FROM');
    const baseUrl = (
      this.configService.get<string>('ADMIN_APP_URL') ?? DEFAULT_ADMIN_APP_URL
    ).replace(/\/+$/, '');
    const ticketUrl = `${baseUrl}/tickets/${data.ticketId}`;
    const title = escapeHtml(data.title);

    await this.transporter.sendMail({
      from,
      to,
      subject: `Se te asignó el ticket #${data.code}: ${data.title} — DYRA Analítica`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #f9f9f9; border-radius: 8px;">
          <h2 style="color: #1a1a2e; margin-bottom: 8px;">Tienes un ticket asignado</h2>
          <p style="color: #444; margin-bottom: 24px;">
            <strong>${escapeHtml(data.assignedByName)}</strong> te asignó un ticket que requiere tu atención en <strong>DYRA Analítica</strong>.
          </p>
          <table style="width: 100%; background: #ffffff; border: 2px solid #e0e0e0; border-radius: 8px; padding: 16px; margin-bottom: 24px; color: #444; font-size: 14px;">
            <tr><td style="padding: 4px 8px; color: #888;">Ticket</td><td style="padding: 4px 8px;"><strong>#${data.code}</strong></td></tr>
            <tr><td style="padding: 4px 8px; color: #888;">Título</td><td style="padding: 4px 8px;">${title}</td></tr>
            <tr><td style="padding: 4px 8px; color: #888;">Prioridad</td><td style="padding: 4px 8px;">${escapeHtml(data.priorityLabel)}</td></tr>
            <tr><td style="padding: 4px 8px; color: #888;">Sucursal</td><td style="padding: 4px 8px;">${escapeHtml(data.branchName)}</td></tr>
            <tr><td style="padding: 4px 8px; color: #888;">Asignado por</td><td style="padding: 4px 8px;">${escapeHtml(data.assignedByName)}</td></tr>
          </table>
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${ticketUrl}" style="display: inline-block; background: #1a1a2e; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold;">Ver ticket</a>
          </div>
          <p style="color: #666; font-size: 13px;">
            Si el botón no funciona, copia este enlace en tu navegador:<br/>
            <a href="${ticketUrl}" style="color: #1a1a2e;">${ticketUrl}</a>
          </p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px; text-align: center;">
            DYRA Analítica — No respondas a este correo automático.
          </p>
        </div>
      `,
    });
  }
}
