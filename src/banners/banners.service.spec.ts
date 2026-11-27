import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { BannersService } from './banners.service';

const BRANCH_ID = 'a1b2c3d4-0001-4000-8000-000000000001';

describe('BannersService', () => {
  const tx = {
    banner: {
      updateMany: jest.fn(),
      create: jest.fn((args: unknown) => args),
      update: jest.fn((args: unknown) => args),
    },
  };
  const prisma = {
    banner: { findFirst: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new BannersService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('guarda los textos recortados y los precios como Decimal', async () => {
      prisma.banner.findFirst.mockResolvedValue(null);

      await service.create({
        branchId: BRANCH_ID,
        placement: 'PROMO',
        imageUrl: 'https://res.cloudinary.com/x/promo.jpg',
        mobileImageUrl: 'https://res.cloudinary.com/x/promo-m.jpg',
        title: '  Perfil tiroideo  ',
        description: '',
        linkUrl: '/study/perfil-tiroideo',
        promoPrice: 299,
        regularPrice: 450,
      });

      const { data } = tx.banner.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data).toMatchObject({
        placement: 'PROMO',
        title: 'Perfil tiroideo',
        description: null,
        linkUrl: '/study/perfil-tiroideo',
        promoPrice: new Prisma.Decimal(299),
        regularPrice: new Prisma.Decimal(450),
      });
    });

    it('rechaza un precio normal menor o igual al de promoción', async () => {
      await expect(
        service.create({
          branchId: BRANCH_ID,
          imageUrl: 'https://res.cloudinary.com/x/promo.jpg',
          mobileImageUrl: 'https://res.cloudinary.com/x/promo-m.jpg',
          promoPrice: 300,
          regularPrice: 300,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    const current = {
      id: 'b1',
      branchId: BRANCH_ID,
      placement: 'PROMO',
      order: 0,
      startAt: null,
      endAt: null,
      promoPrice: new Prisma.Decimal(299),
      regularPrice: new Prisma.Decimal(450),
    };

    it('valida el precio nuevo contra el precio guardado', async () => {
      prisma.banner.findUnique.mockResolvedValue(current);

      await expect(
        service.update('b1', { promoPrice: 500 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('no toca los textos que no se envían y limpia los que llegan en null', async () => {
      prisma.banner.findUnique.mockResolvedValue(current);

      await service.update('b1', { title: null, ctaLabel: 'Agendar' });

      const { data } = tx.banner.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.title).toBeNull();
      expect(data.ctaLabel).toBe('Agendar');
      expect(data.description).toBeUndefined();
      expect(data.promoPrice).toBeUndefined();
    });
  });
});
