import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService, PUBLIC_IMAGE_FORMATS } from './cloudinary.service';

describe('CloudinaryService.generateSignedImageUploadParams', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = {
      ...env,
      CLOUDINARY_CLOUD_NAME: 'demo',
      CLOUDINARY_API_KEY: 'key',
      CLOUDINARY_API_SECRET: 'secret',
    };
  });

  afterAll(() => {
    process.env = env;
  });

  it('signs a public image upload under the folder with a random id', () => {
    const service = new CloudinaryService();
    const params = service.generateSignedImageUploadParams('banners');

    expect(params).toMatchObject({
      cloudName: 'demo',
      apiKey: 'key',
      type: 'upload',
      resourceType: 'image',
      allowedFormats: PUBLIC_IMAGE_FORMATS,
    });
    expect(params.publicId).toMatch(/^banners\/[0-9a-f-]{36}$/);
    expect(params.signature).toBe(
      cloudinary.utils.api_sign_request(
        {
          timestamp: params.timestamp,
          public_id: params.publicId,
          type: 'upload',
          allowed_formats: PUBLIC_IMAGE_FORMATS,
        },
        'secret',
      ),
    );
  });

  it('never returns the API secret', () => {
    const params = new CloudinaryService().generateSignedImageUploadParams(
      'services',
    );
    expect(JSON.stringify(params)).not.toContain('secret');
  });
});
