import { DeviceType } from '@prisma/client';

export type SafeguardSectionKey = 'computer' | 'mobile';

// Tipos de equipo que generan su propia sección top-level en un Safeguard
// (computer/mobile en el formato ADM.F.00 — vehículo vive en su propio
// VehicleSafeguard, ver src/vehicle-safeguards/).
export const SECTION_DEVICE_TYPE: Record<SafeguardSectionKey, DeviceType> = {
  computer: DeviceType.COMPUTER,
  mobile: DeviceType.MOBILE,
};

export const SECTION_KEY_BY_DEVICE_TYPE: Partial<Record<DeviceType, SafeguardSectionKey>> = {
  [DeviceType.COMPUTER]: 'computer',
  [DeviceType.MOBILE]: 'mobile',
};

// Periféricos que no tienen sección propia: se cuelgan como "Accesorios
// incluidos" de la sección `computer` del empleado (ver safeguards.service.ts).
export const ACCESSORY_DEVICE_TYPES: DeviceType[] = [
  DeviceType.MONITOR,
  DeviceType.KEYBOARD,
  DeviceType.MOUSE,
];

export function getSafeguardSectionForType(type: DeviceType): SafeguardSectionKey | null {
  return SECTION_KEY_BY_DEVICE_TYPE[type] ?? null;
}
