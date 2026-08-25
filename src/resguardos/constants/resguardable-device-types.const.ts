import { DeviceType } from '@prisma/client';

export type ResguardoSectionKey = 'computer' | 'mobile' | 'vehicle';

// Tipos de equipo que generan su propia sección top-level en un Resguardo
// (computer/mobile/vehicle en el formato ADM.F.00).
export const SECTION_DEVICE_TYPE: Record<ResguardoSectionKey, DeviceType> = {
  computer: DeviceType.COMPUTER,
  mobile: DeviceType.MOBILE,
  vehicle: DeviceType.VEHICLE,
};

export const SECTION_KEY_BY_DEVICE_TYPE: Partial<Record<DeviceType, ResguardoSectionKey>> = {
  [DeviceType.COMPUTER]: 'computer',
  [DeviceType.MOBILE]: 'mobile',
  [DeviceType.VEHICLE]: 'vehicle',
};

// Periféricos que no tienen sección propia: se cuelgan como "Accesorios
// incluidos" de la sección `computer` del empleado (ver resguardos.service.ts).
export const ACCESSORY_DEVICE_TYPES: DeviceType[] = [
  DeviceType.MONITOR,
  DeviceType.KEYBOARD,
  DeviceType.MOUSE,
];

export function getResguardoSectionForType(type: DeviceType): ResguardoSectionKey | null {
  return SECTION_KEY_BY_DEVICE_TYPE[type] ?? null;
}
