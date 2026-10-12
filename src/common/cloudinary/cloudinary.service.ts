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
