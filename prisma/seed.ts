import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedStudies } from './seeds/studies.seed';
import { seedServices } from './seeds/services.seed';
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

  // 2. Sucursales (dependen de States; crean también sus PriceSheets)
  await seedBranches(prisma);

  // 3. Servicios (cada servicio requiere un branchId de una sucursal existente)
  await seedServices(prisma);
  console.log('✅ Services seeded.');

  // 4. Estudios (dependen de Services y de las PriceSheets de las sucursales)
  await seedStudies(prisma);
  console.log('✅ Studies (with prices) seeded.');

  // 5. Banners (dependen de las sucursales)
  await seedBanners(prisma);

  // 6. Autores (independientes)
  await seedAuthors(prisma);

  // 7. Posts (dependen de Authors y Branches)
  await seedPosts(prisma);

  // 8. Reseñas (dependen de Branches)
  await seedReviews(prisma);

  // 9. Roles y permisos (independientes)
  await seedRolesAndPermissions(prisma);
  console.log('✅ Roles and permissions seeded.');

  // 10. Usuario administrador (depende del rol Administrador)
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
