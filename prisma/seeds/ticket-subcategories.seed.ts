import { Category, PrismaClient } from '@prisma/client';

const TICKET_SUBCATEGORIES: { category: Category; name: string }[] = [
  { category: 'COGNITI', name: 'Crear cliente' },
  { category: 'COGNITI', name: 'Crear parámetro' },
  { category: 'COGNITI', name: 'Actualizar parámetro' },
  { category: 'COGNITI', name: 'Actualizar precio de parámetro' },
];

export async function seedTicketSubcategories(prisma: PrismaClient) {
  for (const subcategory of TICKET_SUBCATEGORIES) {
    await prisma.ticketSubcategory.upsert({
      where: {
        category_name: {
          category: subcategory.category,
          name: subcategory.name,
        },
      },
      update: {},
      create: subcategory,
    });
  }

  console.log('✅ Seeding ticket subcategories finished.');
}
