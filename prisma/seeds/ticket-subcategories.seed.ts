import { Category, PrismaClient, TicketFormType } from '@prisma/client';

const TICKET_SUBCATEGORIES: {
  category: Category;
  name: string;
  formType: TicketFormType | null;
  isActive: boolean;
}[] = [
  {
    category: 'COGNITI',
    name: 'Crear cliente',
    formType: 'CLIENT_CREATE',
    isActive: true,
  },
  {
    category: 'COGNITI',
    name: 'Crear parámetro',
    formType: 'STUDY_CREATE',
    isActive: true,
  },
  {
    category: 'COGNITI',
    name: 'Actualizar parámetro',
    formType: 'STUDY_UPDATE',
    isActive: true,
  },
  {
    category: 'COGNITI',
    name: 'Actualizar valores de referencia',
    formType: 'REFERENCE_VALUES_UPDATE',
    isActive: true,
  },
  // Covered by "Actualizar parámetro" (STUDY_UPDATE also changes prices).
  {
    category: 'COGNITI',
    name: 'Actualizar precio de parámetro',
    formType: null,
    isActive: false,
  },
];

export async function seedTicketSubcategories(prisma: PrismaClient) {
  for (const subcategory of TICKET_SUBCATEGORIES) {
    const { formType, isActive } = subcategory;
    await prisma.ticketSubcategory.upsert({
      where: {
        category_name: {
          category: subcategory.category,
          name: subcategory.name,
        },
      },
      update: { formType, isActive },
      create: subcategory,
    });
  }

  console.log('✅ Seeding ticket subcategories finished.');
}
