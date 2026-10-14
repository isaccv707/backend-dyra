import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Copies `name` into `title` for legacy studies created before `title` existed.
async function main() {
  const updated = await prisma.$executeRaw`
    UPDATE "studies" SET "title" = "name" WHERE "title" IS NULL
  `;
  console.log(`✅ ${updated} estudio(s) con title = name.`);
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
