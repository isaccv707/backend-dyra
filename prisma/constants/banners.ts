import { BannerPlacement } from '@prisma/client';

export const BANNERS = [
  {
    id: 'b1a2c3d4-0001-4000-8000-000000000001',
    placement: BannerPlacement.HOME,
    imageUrl:
      'https://res.cloudinary.com/dpxcnew1i/image/upload/v1782235716/PRUEBA_DESKTOP_C_72PP_buiek1.jpg',
    mobileImageUrl:
      'https://res.cloudinary.com/dpxcnew1i/image/upload/v1782235740/PRUEBA_MOBILE_C_72PP_wuwfs7.jpg',
    order: 0,
    isActive: true,
    branchName: 'Sucursal Guadalajara',
  },
  {
    id: 'b1a2c3d4-0002-4000-8000-000000000002',
    placement: BannerPlacement.HOME,
    imageUrl:
      'https://res.cloudinary.com/dpxcnew1i/image/upload/v1782235716/PRUEBA_DESKTOP_D_72PP_kul4ds.jpg',
    mobileImageUrl:
      'https://res.cloudinary.com/dpxcnew1i/image/upload/v1782235738/PRUEBA_MOBILE_D_72PP_vdk9cw.jpg',
    order: 0,
    isActive: true,
    branchName: 'Sucursal Colima',
  },
];
