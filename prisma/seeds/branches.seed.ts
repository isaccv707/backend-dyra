import { DayOfWeek, PrismaClient } from '@prisma/client';
import { PRICE_SHEETS } from '../constants/price-sheets';

const WEEKDAYS_SCHEDULE = [
  { dayOfWeek: DayOfWeek.MONDAY, openTime: '08:00', closeTime: '18:00' },
  { dayOfWeek: DayOfWeek.TUESDAY, openTime: '08:00', closeTime: '18:00' },
  { dayOfWeek: DayOfWeek.WEDNESDAY, openTime: '08:00', closeTime: '18:00' },
  { dayOfWeek: DayOfWeek.THURSDAY, openTime: '08:00', closeTime: '18:00' },
  { dayOfWeek: DayOfWeek.FRIDAY, openTime: '08:00', closeTime: '18:00' },
  {
    dayOfWeek: DayOfWeek.SATURDAY,
    openTime: '09:00',
    closeTime: '13:00',
  },
  {
    dayOfWeek: DayOfWeek.SUNDAY,
    openTime: null,
    closeTime: null,
    isClosed: true,
  },
];

const BRANCHES = [
  {
    id: 'a1b2c3d4-0001-4000-8000-000000000001',
    name: 'Sucursal Guadalajara',
    phone: '3312345678',
    email: 'guadalajara@dyranalitica.com',
    urlResults: 'https://resultados.dyranalitica.com',
    priceSheet: PRICE_SHEETS.JALISCO,
    stateName: 'Jalisco',
    address: {
      street: 'Av. Vallarta',
      extNumber: '1234',
      zipCode: '44100',
      city: 'Guadalajara',
      neighborhood: 'Americana',
    },
    schedules: WEEKDAYS_SCHEDULE,
  },
  {
    id: 'a1b2c3d4-0002-4000-8000-000000000002',
    name: 'Sucursal Colima',
    phone: '3121234567',
    email: 'colima@dyranalitica.com',
    urlResults: 'https://resultados.dyranalitica.com',
    priceSheet: PRICE_SHEETS.COLIMA,
    stateName: 'Colima',
    address: {
      street: 'Blvd. Camino Real',
      extNumber: '500',
      zipCode: '28010',
      city: 'Colima',
      neighborhood: 'Centro',
    },
    schedules: WEEKDAYS_SCHEDULE,
  },
];

export async function seedBranches(prisma: PrismaClient) {
  for (const branch of BRANCHES) {
    const { id, stateName, address, priceSheet, schedules, ...branchData } =
      branch;

    const state = await prisma.state.findUnique({ where: { name: stateName } });
    if (!state) {
      throw new Error(
        `Estado '${stateName}' no encontrado. Ejecuta seedStates primero.`,
      );
    }

    const existing = await prisma.branch.findUnique({ where: { id } });

    if (existing) {
      await prisma.branch.update({
        where: { id },
        data: { ...branchData, stateId: state.id },
      });
    } else {
      const createdAddress = await prisma.address.create({ data: address });
      await prisma.branch.create({
        data: {
          id,
          ...branchData,
          stateId: state.id,
          addressId: createdAddress.id,
        },
      });
    }

    await prisma.priceSheets.upsert({
      where: { id: priceSheet.id },
      update: { branchId: id, isPublic: true },
      create: {
        id: priceSheet.id,
        name: priceSheet.name,
        description: priceSheet.description,
        branchId: id,
        isPublic: true,
      },
    });

    for (const schedule of schedules) {
      await prisma.branchSchedule.upsert({
        where: {
          branchId_dayOfWeek: { branchId: id, dayOfWeek: schedule.dayOfWeek },
        },
        update: schedule,
        create: { ...schedule, branchId: id },
      });
    }
  }

  console.log('✅ Branches seeded.');
}
