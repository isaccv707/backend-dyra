import { BlockType, PostStatus } from '@prisma/client';

interface RawContentBlock {
  type: BlockType;
  order: number;
  content?: string;
  src?: string;
  alt?: string;
}

interface RawPost {
  title: string;
  description: string;
  excerpt: string;
  image?: string;
  readingTime?: number;
  metaDescription?: string;
  status?: PostStatus;
  tags: string[];
  category: string;
  authorName: string;
  contentBlocks: RawContentBlock[];
  /** Sucursales a las que queda exclusivo este post. Si se omite, es global (visible en todas). */
  branchNames?: string[];
}

export const POSTS: RawPost[] = [
  {
    title: '5 estudios de laboratorio que debes hacerte cada año',
    description:
      'Una guía práctica sobre los análisis clínicos esenciales para monitorear tu salud de forma anual.',
    excerpt:
      'Conoce los estudios básicos que todo adulto debería realizarse una vez al año para prevenir enfermedades.',
    image:
      'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030914/analisis_sral07.png',
    readingTime: 4,
    metaDescription:
      'Descubre los 5 estudios de laboratorio recomendados para un chequeo anual de salud.',
    status: PostStatus.PUBLISHED,
    tags: ['prevención', 'salud general', 'chequeo anual'],
    category: 'Salud General',
    authorName: 'Fernanda López Ruiz',
    contentBlocks: [
      { type: BlockType.SUBTITLE, order: 1, content: '¿Por qué hacerte un chequeo anual?' },
      {
        type: BlockType.PARAGRAPH,
        order: 2,
        content:
          'La detección temprana es la mejor herramienta para prevenir enfermedades crónicas. Un chequeo anual permite identificar alteraciones antes de que se conviertan en un problema mayor.',
      },
      {
        type: BlockType.LIST,
        order: 3,
        content:
          'Biometría hemática completa\nQuímica sanguínea de 27 elementos\nPerfil de lípidos\nExamen general de orina\nPerfil tiroideo',
      },
      {
        type: BlockType.QUOTE,
        order: 4,
        content: 'Prevenir siempre es más económico y menos doloroso que curar.',
      },
    ],
  },
  {
    title: 'Cómo interpretar tu perfil de lípidos',
    description:
      'Explicamos en términos simples qué significan los valores de colesterol y triglicéridos en tus resultados.',
    excerpt:
      'Aprende a leer tus resultados de colesterol total, HDL, LDL y triglicéridos sin confusiones.',
    image:
      'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030915/salud_ubcyxb.png',
    readingTime: 5,
    metaDescription: 'Guía para entender tu perfil de lípidos y qué hacer con los resultados.',
    status: PostStatus.PUBLISHED,
    tags: ['colesterol', 'bienestar', 'resultados'],
    category: 'Bienestar',
    authorName: 'Carlos Mendoza Vidal',
    contentBlocks: [
      { type: BlockType.SUBTITLE, order: 1, content: 'Los cuatro valores clave' },
      {
        type: BlockType.PARAGRAPH,
        order: 2,
        content:
          'El perfil de lípidos mide colesterol total, colesterol HDL (bueno), colesterol LDL (malo) y triglicéridos. Cada uno cuenta una parte distinta de tu salud cardiovascular.',
      },
      {
        type: BlockType.PARAGRAPH,
        order: 3,
        content:
          'Valores elevados de LDL o triglicéridos, combinados con un HDL bajo, incrementan el riesgo cardiovascular y suelen requerir cambios en el estilo de vida.',
      },
    ],
  },
  {
    title: 'DYRA Guadalajara amplía su horario de atención',
    description:
      'A partir de este mes, nuestra sucursal en Guadalajara atenderá en un horario extendido para tu comodidad.',
    excerpt:
      'Nuevo horario extendido en la sucursal Guadalajara para que agendes tus estudios con más flexibilidad.',
    image:
      'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030916/toma_kjgiit.png',
    readingTime: 2,
    metaDescription: 'Conoce el nuevo horario extendido de la sucursal DYRA Guadalajara.',
    status: PostStatus.PUBLISHED,
    tags: ['guadalajara', 'sucursal', 'horarios'],
    category: 'Noticias',
    authorName: 'Roberto Silva Campos',
    branchNames: ['Sucursal Guadalajara'],
    contentBlocks: [
      { type: BlockType.SUBTITLE, order: 1, content: 'Más horas para atenderte' },
      {
        type: BlockType.PARAGRAPH,
        order: 2,
        content:
          'Escuchamos a nuestra comunidad en Guadalajara: a partir de este mes ampliamos el horario de toma de muestras de lunes a sábado para que puedas agendar tu estudio antes o después del trabajo.',
      },
    ],
  },
  {
    title: 'Nueva alianza empresarial en la Zona Metropolitana de Guadalajara',
    description:
      'Firmamos convenios con empresas de la ZMG para ofrecer paquetes de salud ocupacional preferenciales.',
    excerpt:
      'DYRA Guadalajara se une a empresas de la zona metropolitana para impulsar la salud ocupacional.',
    image:
      'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030915/salud_ubcyxb.png',
    readingTime: 3,
    metaDescription: 'Nueva alianza empresarial de DYRA en la Zona Metropolitana de Guadalajara.',
    status: PostStatus.PUBLISHED,
    tags: ['empresarial', 'guadalajara', 'alianzas'],
    category: 'Empresarial',
    authorName: 'Roberto Silva Campos',
    branchNames: ['Sucursal Guadalajara'],
    contentBlocks: [
      { type: BlockType.SUBTITLE, order: 1, content: 'Salud ocupacional al alcance de más empresas' },
      {
        type: BlockType.PARAGRAPH,
        order: 2,
        content:
          'A través de nuevos convenios con cámaras empresariales de la ZMG, las compañías afiliadas acceden a paquetes preferenciales de exámenes de ingreso y checkups ejecutivos.',
      },
    ],
  },
  {
    title: 'Jornada de salud gratuita en Colima',
    description:
      'Este mes realizamos una jornada de detección gratuita de glucosa y presión arterial en el centro de Colima.',
    excerpt:
      'Participa en nuestra jornada de salud gratuita en el centro de la ciudad de Colima.',
    image:
      'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030914/analisis_sral07.png',
    readingTime: 2,
    metaDescription: 'Jornada de salud gratuita organizada por DYRA en Colima.',
    status: PostStatus.PUBLISHED,
    tags: ['colima', 'comunidad', 'prevención'],
    category: 'Noticias',
    authorName: 'Ana Torres Gómez',
    branchNames: ['Sucursal Colima'],
    contentBlocks: [
      { type: BlockType.SUBTITLE, order: 1, content: 'Salud preventiva para toda la comunidad' },
      {
        type: BlockType.PARAGRAPH,
        order: 2,
        content:
          'En colaboración con el municipio, DYRA Colima realizará tamizajes gratuitos de glucosa capilar y presión arterial durante todo el fin de semana en el centro de la ciudad.',
      },
    ],
  },
  {
    title: 'Tomas a domicilio: cobertura ampliada en Colima',
    description:
      'Ampliamos la zona de cobertura del servicio de toma de muestras a domicilio en el municipio de Colima.',
    excerpt:
      'El servicio de tomas a domicilio ahora cubre más colonias dentro del municipio de Colima.',
    image:
      'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030916/toma_kjgiit.png',
    readingTime: 2,
    metaDescription: 'Cobertura ampliada del servicio de tomas a domicilio en Colima.',
    status: PostStatus.PUBLISHED,
    tags: ['colima', 'tomas a domicilio', 'servicio'],
    category: 'Servicios',
    authorName: 'Ana Torres Gómez',
    branchNames: ['Sucursal Colima'],
    contentBlocks: [
      { type: BlockType.SUBTITLE, order: 1, content: 'Más colonias, la misma comodidad' },
      {
        type: BlockType.PARAGRAPH,
        order: 2,
        content:
          'Gracias a la respuesta de nuestros pacientes, el servicio de tomas a domicilio en Colima ahora cubre colonias adicionales sin costo extra dentro del municipio.',
      },
    ],
  },
];
