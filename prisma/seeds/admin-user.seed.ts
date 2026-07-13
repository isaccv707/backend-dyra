import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const ADMIN_ROLE_NAME = 'Administrador';

export async function seedAdminUser(prisma: PrismaClient) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email) {
    throw new Error('La variable de entorno ADMIN_EMAIL es requerida.');
  }
  if (!password) {
    throw new Error('La variable de entorno SEED_ADMIN_PASSWORD es requerida.');
  }

  const adminRole = await prisma.role.findFirst({ where: { name: ADMIN_ROLE_NAME } });
  if (!adminRole) {
    throw new Error(
      `El rol '${ADMIN_ROLE_NAME}' no existe. Ejecuta primero el seed de roles y permisos.`,
    );
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const branches = await prisma.branch.findMany({ select: { id: true } });

  await prisma.user.upsert({
    where: { email },
    update: {
      name: 'Administrador Sistema',
      password: hashedPassword,
      isActive: true,
      role: { connect: { id: adminRole.id } },
      branches: { set: branches.map((b) => ({ id: b.id })) },
    },
    create: {
      email,
      name: 'Administrador Sistema',
      password: hashedPassword,
      isActive: true,
      role: { connect: { id: adminRole.id } },
      branches: { connect: branches.map((b) => ({ id: b.id })) },
    },
  });

  console.log(
    `✅ Usuario administrador (${email}) creado/actualizado con ${branches.length} sucursal(es) asignada(s).`,
  );
}
