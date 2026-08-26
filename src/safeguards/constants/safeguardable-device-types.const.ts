import { DeviceType } from '@prisma/client';

export type SafeguardSectionKey = 'computer' | 'mobile' | 'vehicle';

// Tipos de equipo que generan su propia sección top-level en un Safeguard
// (computer/mobile/vehicle en el formato ADM.F.00).
export const SECTION_DEVICE_TYPE: Record<SafeguardSectionKey, DeviceType> = {
  computer: DeviceType.COMPUTER,
  mobile: DeviceType.MOBILE,
  vehicle: DeviceType.VEHICLE,
};

export const SECTION_KEY_BY_DEVICE_TYPE: Partial<Record<DeviceType, SafeguardSectionKey>> = {
  [DeviceType.COMPUTER]: 'computer',
  [DeviceType.MOBILE]: 'mobile',
  [DeviceType.VEHICLE]: 'vehicle',
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
