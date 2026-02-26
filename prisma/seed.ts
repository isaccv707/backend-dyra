import 'dotenv/config';
import { PrismaClient } from "@prisma/client"
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedStudies } from "./seeds/studies.seed";

if (!process.env.DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL no encontrada en las variables de entorno.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('Starting the process of seeding')
    await seedStudies(prisma);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    })