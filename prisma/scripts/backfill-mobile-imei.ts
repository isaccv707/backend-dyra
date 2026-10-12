import 'dotenv/config';
import { DeviceType, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const mobiles = await prisma.deviceItem.findMany({
    where: {
      catalog: { type: DeviceType.MOBILE },
      serialNumber: { not: null },
      imei: null,
    },
    select: { id: true, serialNumber: true },
  });

  for (const device of mobiles) {
    await prisma.deviceItem.update({
      where: { id: device.id },
      data: { imei: device.serialNumber, serialNumber: null },
    });
  }

  const details = await prisma.safeguardMobileDetail.findMany({
    where: { internalCode: null },
    select: { id: true, device: { select: { internalCode: true } } },
  });

  for (const detail of details) {
    await prisma.safeguardMobileDetail.update({
      where: { id: detail.id },
      data: { internalCode: detail.device.internalCode },
    });
  }

  console.log(
    `✅ Backfill finished. ${mobiles.length} mobile device(s) moved serialNumber -> imei, ${details.length} mobile safeguard detail(s) got internalCode.`,
  );
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
