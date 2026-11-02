import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { TicketFormDb } from './ticket-form-handler.interface';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
/** Stored as `v1:<iv>:<auth tag>:<ciphertext>` (base64). */
const FORMAT_VERSION = 'v1';

/** Encrypts the secrets typed in ticket forms with TICKET_SECRET_KEY. */
@Injectable()
export class TicketFormSecretService implements OnModuleInit {
  /** Fails at startup, not when the first request needs the key. */
  onModuleInit() {
    this.key();
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key(), iv);
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    return [
      FORMAT_VERSION,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  /** Throws if the value was altered or encrypted with another key. */
  decrypt(stored: string): string {
    const [version, iv, authTag, encrypted] = stored.split(':');
    if (version !== FORMAT_VERSION || !iv || !authTag || !encrypted) {
      throw new Error('Unknown ticket secret format');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key(),
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private key(): Buffer {
    const key = Buffer.from(process.env.TICKET_SECRET_KEY ?? '', 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `TICKET_SECRET_KEY must be ${KEY_BYTES} bytes encoded in base64`,
      );
    }
    return key;
  }
}

/**
 * Deletes the form's secret. Run in the same transaction that closes or cancels
 * the ticket; a form without a secret is left untouched.
 */
export const purgeFormSecret = (db: TicketFormDb, ticketId: string) =>
  db.ticketForm.updateMany({
    where: { ticketId, hasSecret: true },
    data: {
      encryptedSecret: null,
      hasSecret: false,
      secretPurgedAt: new Date(),
    },
  });
