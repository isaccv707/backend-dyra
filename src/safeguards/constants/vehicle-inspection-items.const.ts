import { SafeguardVehicleInspectionSection } from '@prisma/client';

export interface VehicleInspectionItemDefinition {
  key: string;
  label: string;
  section: SafeguardVehicleInspectionSection;
}

// Renglones fijos de la tabla "Revisión" del formato ADM.F.00, en el orden
// impreso en el formato.
export const VEHICLE_REVISION_ITEMS: Omit<VehicleInspectionItemDefinition, 'section'>[] = [
  { key: 'carnet_servicio', label: 'Carnet de servicio' },
  { key: 'manuales', label: 'Manuales' },
  { key: 'poliza_seguro_vigente', label: 'Póliza de seguro vigente' },
  { key: 'tarjeta_circulacion', label: 'Tarjeta de circulación' },
  { key: 'verificacion_vehicular', label: 'Verificación vehicular' },
  { key: 'birlo_seguridad', label: 'Birlo de seguridad' },
  { key: 'licencia_conducir', label: 'Licencia para conducir' },
  { key: 'tarjeta_gasolina', label: 'Tarjeta de gasolina N°' },
];

// Renglones fijos de la tabla "Inspección" del formato ADM.F.00. El formato
// los distribuye en dos columnas visuales; aquí se aplanan a una sola lista
// ordenada.
export const VEHICLE_BODY_INSPECTION_ITEMS: Omit<VehicleInspectionItemDefinition, 'section'>[] = [
  { key: 'capote', label: 'Capote' },
  { key: 'techo', label: 'Techo' },
  { key: 'lateral_izquierdo', label: 'Lateral Izquierdo' },
  { key: 'lateral_derecho', label: 'Lateral Derecho' },
  { key: 'compuerta', label: 'Compuerta' },
  { key: 'parachoques', label: 'Parachoques' },
  { key: 'guardachoque', label: 'Guardachoque' },
  { key: 'estribo_izquierdo', label: 'Estribo Izquierdo' },
  { key: 'estribo_derecho', label: 'Estribo derecho' },
  { key: 'cables_pasa_corriente', label: 'Cables pasa corriente' },
  { key: 'antena', label: 'Antena' },
  { key: 'bocinas', label: 'Bocinas' },
  { key: 'encendedor', label: 'Encendedor' },
  { key: 'herramienta', label: 'Herramienta' },
  { key: 'gato_mecanico', label: 'Gato mecánico' },
  { key: 'extintor', label: 'Extintor' },
  { key: 'llanta_auxiliar', label: 'Llanta auxiliar' },
  { key: 'juego_reflejantes', label: 'Juego de reflejantes' },
  { key: 'juego_llaves', label: 'Juego de llaves' },
  { key: 'tapetes', label: 'Tapetes' },
];

export const VEHICLE_INSPECTION_ITEMS: VehicleInspectionItemDefinition[] = [
  ...VEHICLE_REVISION_ITEMS.map((item) => ({ ...item, section: SafeguardVehicleInspectionSection.DOCUMENTS })),
  ...VEHICLE_BODY_INSPECTION_ITEMS.map((item) => ({ ...item, section: SafeguardVehicleInspectionSection.BODY })),
];

export const VEHICLE_INSPECTION_ITEM_KEYS: string[] = VEHICLE_INSPECTION_ITEMS.map((item) => item.key);

export function getVehicleInspectionItemSection(key: string): SafeguardVehicleInspectionSection {
  const item = VEHICLE_INSPECTION_ITEMS.find((i) => i.key === key);
  if (!item) {
    throw new Error(`Unknown vehicle inspection item key: ${key}`);
  }
  return item.section;
}

export function getVehicleInspectionItemLabel(key: string): string {
  return VEHICLE_INSPECTION_ITEMS.find((i) => i.key === key)?.label ?? key;
}
