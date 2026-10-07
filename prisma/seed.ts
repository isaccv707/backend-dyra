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
import { seedTicketSubcategories } from './seeds/ticket-subcategories.seed';

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

  await seedRolesAndPermissions(prisma);
  console.log('✅ Roles and permissions seeded.');

  await seedAdminUser(prisma);

  await seedTicketSubcategories(prisma);

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
