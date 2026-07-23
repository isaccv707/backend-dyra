import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedStudies } from './seeds/studies.seed';
import { seedServices, linkServiceBranches } from './seeds/services.seed';
import { seedStates } from './seeds/states.seed';
import { seedRolesAndPermissions } from './seeds/roles-permissions.seed';
import { seedAdminUser } from './seeds/admin-user.seed';
import { seedBranches } from './seeds/branches.seed';
import { seedBanners } from './seeds/banners.seed';
import { seedAuthors } from './seeds/authors.seed';
import { seedPosts } from './seeds/posts.seed';
import { seedReviews } from './seeds/reviews.seed';

if (!process.env.DATABASE_URL) {
  console.error(
    '❌ Error: DATABASE_URL no encontrada en las variables de entorno.',
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🚀 Starting the process of seeding...');

  // 1. Primero los Estados (Nivel base, no dependen de nadie)
  await seedStates(prisma);
  console.log('✅ States seeded.');

  // 2. Luego los Servicios (Nivel base para los estudios)
  await seedServices(prisma);
  console.log('✅ Services seeded.');

  // 3. Sucursales (dependen de States; crean también sus PriceSheets)
  await seedBranches(prisma);

  // 4. Estudios (dependen de Services y de las PriceSheets de las sucursales)
  await seedStudies(prisma);
  console.log('✅ Studies (with prices) seeded.');

  // 5. Vincula servicios exclusivos a sus sucursales (depende de Branches y Services)
  await linkServiceBranches(prisma);

  // 6. Banners (dependen de las sucursales)
  await seedBanners(prisma);

  // 7. Autores (independientes)
  await seedAuthors(prisma);

  // 8. Posts (dependen de Authors y Branches)
  await seedPosts(prisma);

  // 9. Reseñas (dependen de Branches)
  await seedReviews(prisma);

  // 10. Roles y permisos (independientes)
  await seedRolesAndPermissions(prisma);
  console.log('✅ Roles and permissions seeded.');

  // 11. Usuario administrador (depende del rol Administrador)
  await seedAdminUser(prisma);

  console.log('All seeds completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
