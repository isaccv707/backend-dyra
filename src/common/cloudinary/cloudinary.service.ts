import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

export interface SignedDownloadUrl {
  url: string;
  expiresAt: Date;
}

// Genera URLs de descarga firmadas y con expiración para recursos privados
// (type: authenticated) subidos a Cloudinary — nunca genera URLs públicas
// permanentes. El binario nunca pasa por este backend: el frontend sube
// directo a Cloudinary y solo nos manda el public_id resultante.
@Injectable()
export class CloudinaryService {
  private readonly ttlMs = 5 * 60 * 1000;

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  getSignedDownloadUrl(publicId: string): SignedDownloadUrl {
    const expiresAt = new Date(Date.now() + this.ttlMs);

    const url = cloudinary.utils.private_download_url(publicId, 'pdf', {
      resource_type: 'raw',
      type: 'authenticated',
      expires_at: Math.floor(expiresAt.getTime() / 1000),
    });

    return { url, expiresAt };
  }
}
