import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

export interface SignedDownloadUrl {
  url: string;
  expiresAt: Date;
}

export type SignedUploadResourceType = 'raw' | 'auto' | 'image' | 'video';
export type SignedUploadType = 'authenticated' | 'upload';

export interface SignedUploadParams {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  publicId: string;
  type: SignedUploadType;
  resourceType: SignedUploadResourceType;
}

export interface SignedUploadOptions {
  resourceType?: SignedUploadResourceType;
  type?: SignedUploadType;
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

  // Firma los parámetros de un upload directo a Cloudinary (frontend -> Cloudinary,
  // el binario nunca pasa por este backend) fijando type/resource_type desde el
  // servidor — el cliente no puede alterarlos sin invalidar la firma. El upload
  // resultante debe hacerse a POST https://api.cloudinary.com/v1_1/{cloudName}/{resourceType}/upload
  // con estos mismos valores (más el archivo) como multipart/form-data.
  //
  // Por defecto firma type: 'authenticated' + resource_type: 'raw' (documentos
  // privados con expiración, p.ej. PDFs firmados de resguardos — ver
  // getSignedDownloadUrl). Para adjuntos que sí pueden vivir en una URL pública
  // sin expirar (p.ej. fotos de tickets de soporte), pasa
  // { type: 'upload', resourceType: 'auto' }.
  generateSignedUploadParams(
    publicId: string,
    options: SignedUploadOptions = {},
  ): SignedUploadParams {
    const resourceType = options.resourceType ?? 'raw';
    const type = options.type ?? 'authenticated';

    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = {
      timestamp,
      public_id: publicId,
      type,
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET as string,
    );

    return {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME as string,
      apiKey: process.env.CLOUDINARY_API_KEY as string,
      timestamp,
      signature,
      publicId,
      type,
      resourceType,
    };
  }
}
