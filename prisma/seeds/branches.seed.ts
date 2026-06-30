import { PrismaClient } from '@prisma/client';
import { PRICE_SHEETS } from '../constants/price-sheets';

const BRANCHES = [
  {
    id: 'a1b2c3d4-0001-4000-8000-000000000001',
    name: 'Sucursal Guadalajara',
    phone: '3312345678',
    email: 'guadalajara@dyranalitica.com',
    urlResults: 'https://resultados.dyranalitica.com',
    priceSheetId: PRICE_SHEETS.JALISCO.id,
    stateName: 'Jalisco',
    address: {
      street: 'Av. Vallarta',
      extNumber: '1234',
      zipCode: '44100',
      city: 'Guadalajara',
      neighborhood: 'Americana',
    },
  },
  {
    id: 'a1b2c3d4-0002-4000-8000-000000000002',
    name: 'Sucursal Colima',
    phone: '3121234567',
    email: 'colima@dyranalitica.com',
    urlResults: 'https://resultados.dyranalitica.com',
    priceSheetId: PRICE_SHEETS.COLIMA.id,
    stateName: 'Colima',
    address: {
      street: 'Blvd. Camino Real',
      extNumber: '500',
      zipCode: '28010',
      city: 'Colima',
      neighborhood: 'Centro',
    },
  },
];

export async function seedBranches(prisma: PrismaClient) {
  for (const branch of BRANCHES) {
    const { id, stateName, address, priceSheetId, ...branchData } = branch;

    const state = await prisma.state.findUnique({ where: { name: stateName } });
    if (!state) {
      throw new Error(
        `Estado '${stateName}' no encontrado. Ejecuta seedStates primero.`,
      );
    }

    const priceSheet = await prisma.priceSheets.findUnique({
      where: { id: priceSheetId },
    });
    if (!priceSheet) {
      throw new Error(
        `PriceSheet '${priceSheetId}' no encontrado. Ejecuta seedStudies primero.`,
      );
    }

    const existing = await prisma.branch.findUnique({ where: { id } });

    if (existing) {
      await prisma.branch.update({
        where: { id },
        data: { ...branchData, stateId: state.id, priceSheetId },
      });
    } else {
      const createdAddress = await prisma.address.create({ data: address });
      await prisma.branch.create({
        data: {
          id,
          ...branchData,
          stateId: state.id,
          priceSheetId,
          addressId: createdAddress.id,
        },
      });
    }
  }

  console.log('✅ Branches seeded.');
}
