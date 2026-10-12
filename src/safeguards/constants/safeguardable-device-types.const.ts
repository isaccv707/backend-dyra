import { DeviceType } from '@prisma/client';

export type SafeguardSectionKey = 'computer' | 'mobile';

export const SECTION_DEVICE_TYPE: Record<SafeguardSectionKey, DeviceType> = {
  computer: DeviceType.COMPUTER,
  mobile: DeviceType.MOBILE,
};

export const SECTION_KEY_BY_DEVICE_TYPE: Partial<
  Record<DeviceType, SafeguardSectionKey>
> = {
  [DeviceType.COMPUTER]: 'computer',
  [DeviceType.MOBILE]: 'mobile',
};

export const ACCESSORY_DEVICE_TYPES: DeviceType[] = [
  DeviceType.MONITOR,
  DeviceType.KEYBOARD,
  DeviceType.MOUSE,
];

export function getSafeguardSectionForType(
  type: DeviceType,
): SafeguardSectionKey | null {
  return SECTION_KEY_BY_DEVICE_TYPE[type] ?? null;
}
