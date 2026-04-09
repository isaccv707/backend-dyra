import { Prisma } from '@prisma/client';
import slugify from 'slugify';

const rawStudies = [
  {
    name: 'Glucosa',
    code: 'GLU01',
    description:
      'La hemoglobina glicosilada (HbA1c) es una prueba de laboratorio...',
    price: new Prisma.Decimal(250.0), // Nota: Los campos Decimal requieren este constructor
    sampleType: 'Sangre (EDTA)',
    deliveryTime: 1,
    preparation: 'Ayuno de 8 horas.',
    isActive: true,
    serviceId: '2af540f1-20cb-43e7-bba8-3644fb6e1b81',
  },
  {
    name: 'Perfil de Lípidos Completo',
    code: 'HEM-001',
    description:
      'Evaluación detallada de colesterol total, HDL, LDL, VLDL y triglicéridos para determinar el riesgo cardiovascular.',
    price: new Prisma.Decimal(250.0),
    sampleType: 'Sangre (Suero)',
    deliveryTime: 1, // 24 horas
    preparation:
      'Ayuno estricto de 12 horas. No ingerir alcohol 24 horas antes.',
    isActive: true,
    serviceId: '2af540f1-20cb-43e7-bba8-3644fb6e1b81',
  },
  {
    name: 'Hemoglobina Glicosilada (HbA1c)',
    slug: 'hemoglobina-glicosilada-hba1c',
    code: 'GLI-002',
    description:
      'Prueba crucial para el control de diabetes que mide el nivel promedio de glucosa en sangre de los últimos 3 meses.',
    price: new Prisma.Decimal(250.0),
    sampleType: 'Sangre (Sangre total con EDTA)',
    deliveryTime: 1,
    preparation:
      'No requiere ayuno obligatorio, pero se recomienda asistir en condiciones basales.',
    isActive: true,
    serviceId: '2af540f1-20cb-43e7-bba8-3644fb6e1b81',
  },
  {
    name: 'Examen Toxicológico de 5 Elementos',
    slug: 'examen-toxicologico-5-elementos',
    code: 'TOX-005',
    description:
      'Detección de sustancias (Anfetaminas, Benzodiacepinas, Cocaína, Marihuana y Opiáceos). Ideal para ingresos laborales.',
    price: new Prisma.Decimal(250.0),
    sampleType: 'Orina',
    deliveryTime: 1,
    preparation:
      'Se toma la muestra directamente en el laboratorio bajo protocolos de cadena de custodia.',
    isActive: true,
    serviceId: '2af540f1-20cb-43e7-bba8-3644fb6e1b81',
  },
  {
    name: 'Perfil Tiroideo Básico',
    slug: 'perfil-tiroideo-basico',
    code: 'END-003',
    description:
      'Medición de hormonas T3, T4 y TSH para evaluar el funcionamiento de la glándula tiroides.',
    price: new Prisma.Decimal(250.0),
    sampleType: 'Sangre (Suero)',
    deliveryTime: 2, // 48 horass
    preparation:
      'Ayuno de 8 horas. Informar si toma medicamentos para la tiroides.',
    isActive: true,
    serviceId: '2af540f1-20cb-43e7-bba8-3644fb6e1b81',
  },
];

export const STUDIES = rawStudies.map((study) => ({
  ...study,
  slug: slugify(study.name, {
    lower: true,
    strict: true,
    trim: true,
  }),
}));
