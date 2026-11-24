import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedStates } from './seeds/states.seed';
import { seedRolesAndPermissions } from './seeds/roles-permissions.seed';
import { seedAdminUser } from './seeds/admin-user.seed';
import { seedBranches } from './seeds/branches.seed';
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

  // Runs on every production deploy (Railway pre-deploy): only roles,
  // permissions and the admin user. Everything else is development only.
  const isDevSeed =
    process.env.SEED_DEV_BRANCH === 'true' &&
    process.env.NODE_ENV !== 'production';

  await seedRolesAndPermissions(prisma);
  console.log('✅ Roles and permissions seeded.');

  // Development only: production already has active branches that must not be
  // touched (seedBranches updates an existing row). Runs before the admin seed
  // so the admin user gets the branch assigned.
  if (isDevSeed) {
    await seedStates(prisma);
    await seedBranches(prisma);
  }

  await seedAdminUser(prisma);

  if (isDevSeed) {
    await seedTicketSubcategories(prisma);
  }

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
