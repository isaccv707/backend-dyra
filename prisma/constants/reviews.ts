interface RawReview {
  id: number;
  fullName: string;
  avatarUrl?: string;
  rating: number;
  comment?: string;
  isApproved: boolean;
  branchName: string;
}

export const REVIEWS: RawReview[] = [
  {
    id: 9001,
    fullName: 'Mariana Gutiérrez',
    avatarUrl: 'https://ui-avatars.com/api/?name=Mariana+Gutierrez&background=0D8ABC&color=fff',
    rating: 5,
    comment: 'Excelente atención en la sucursal Guadalajara, resultados muy rápidos.',
    isApproved: true,
    branchName: 'Sucursal Guadalajara',
  },
  {
    id: 9002,
    fullName: 'Jorge Ramírez',
    avatarUrl: 'https://ui-avatars.com/api/?name=Jorge+Ramirez&background=1D4ED8&color=fff',
    rating: 5,
    comment: 'El personal de Guadalajara es muy profesional, sin filas de espera.',
    isApproved: true,
    branchName: 'Sucursal Guadalajara',
  },
  {
    id: 9003,
    fullName: 'Paola Hernández',
    avatarUrl: 'https://ui-avatars.com/api/?name=Paola+Hernandez&background=047857&color=fff',
    rating: 4,
    comment: 'Buen servicio, aunque la sala de espera se llena en las mañanas.',
    isApproved: true,
    branchName: 'Sucursal Guadalajara',
  },
  {
    id: 9004,
    fullName: 'Luis Ángel Torres',
    avatarUrl: 'https://ui-avatars.com/api/?name=Luis+Torres&background=B91C1C&color=fff',
    rating: 5,
    comment: 'Pedí la toma a domicilio en Guadalajara y llegaron puntuales.',
    isApproved: true,
    branchName: 'Sucursal Guadalajara',
  },
  {
    id: 9005,
    fullName: 'Diana Flores',
    rating: 3,
    comment: 'El trámite estuvo bien, todavía espero mis resultados.',
    isApproved: false,
    branchName: 'Sucursal Guadalajara',
  },
  {
    id: 9006,
    fullName: 'Ricardo Solano',
    avatarUrl: 'https://ui-avatars.com/api/?name=Ricardo+Solano&background=0D8ABC&color=fff',
    rating: 5,
    comment: 'La sucursal de Colima tiene un trato muy amable y cálido.',
    isApproved: true,
    branchName: 'Sucursal Colima',
  },
  {
    id: 9007,
    fullName: 'Ana Karen Vázquez',
    avatarUrl: 'https://ui-avatars.com/api/?name=Ana+Karen+Vazquez&background=1D4ED8&color=fff',
    rating: 4,
    comment: 'Buena experiencia en la jornada de salud gratuita de Colima.',
    isApproved: true,
    branchName: 'Sucursal Colima',
  },
  {
    id: 9008,
    fullName: 'Emilio Castellanos',
    avatarUrl: 'https://ui-avatars.com/api/?name=Emilio+Castellanos&background=047857&color=fff',
    rating: 5,
    comment: 'Excelente cobertura de tomas a domicilio en Colima.',
    isApproved: true,
    branchName: 'Sucursal Colima',
  },
  {
    id: 9009,
    fullName: 'Sofía Navarro',
    avatarUrl: 'https://ui-avatars.com/api/?name=Sofia+Navarro&background=B91C1C&color=fff',
    rating: 4,
    comment: 'Resultados confiables y entrega puntual en la sucursal Colima.',
    isApproved: true,
    branchName: 'Sucursal Colima',
  },
  {
    id: 9010,
    fullName: 'Héctor Ibarra',
    rating: 2,
    comment: 'Tardaron más de lo esperado en atenderme.',
    isApproved: false,
    branchName: 'Sucursal Colima',
  },
];
