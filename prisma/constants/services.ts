import slugify from "slugify"

interface RawService {
    name: string;
    description: string;
    imageUrl: string;
    mobileImageUrl: string;
    benefits: { title: string; description: string; icon: string }[];
    details: { title: string; description: string }[];
    /** Sucursales a las que queda exclusivo este servicio. Si se omite, es global (visible en todas). */
    branchNames?: string[];
}

const rawServices: RawService[] = [
    {
        name: 'Análisis Clínicos',
        description: 'Analizamos muestras clínicas con equipos de última generación y protocolos estandarizados para asegurar resultados precisos y confiables.',
        imageUrl: 'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030914/analisis_sral07.png',
        mobileImageUrl: 'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030907/ANALISIS_CLINICOS_thnzmf.png',
        benefits: [
            { title: 'Resultados el mismo día', description: 'En el 90% de nuestras pruebas de rutina.', icon: 'Zap' },
            { title: 'Calidad Certificada', description: 'Procesos bajo estándares internacionales de laboratorio.', icon: 'CheckBadge' },
            { title: 'Tecnología de Punta', description: 'Equipos automatizados para minimizar el error humano.', icon: 'CpuChip' },
            { title: 'Privacidad Total', description: 'Manejo seguro y confidencial de tu información médica.', icon: 'LockClosed' }
        ],
        details: [
            { title: 'Química Sanguínea', description: 'Evaluación de glucosa, colesterol, triglicéridos y más.' },
            { title: 'Hematología', description: 'Conteo sanguíneo completo para detectar anemias e infecciones.' },
            { title: 'Inmunología', description: 'Detección de anticuerpos y respuesta del sistema inmune.' },
            { title: 'Uroanálisis', description: 'Examen general de orina para diagnóstico renal y metabólico.' }
        ]
    },
    {
        name: 'Salud Empresarial',
        description: 'Soluciones de salud preventivas y diagnósticas diseñadas específicamente para proteger y optimizar tu capital humano.',
        imageUrl: 'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030915/salud_ubcyxb.png',
        mobileImageUrl: 'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030907/SALUD_EMPRESARIAL_nzwff6.png',
        benefits: [
            { title: 'Atención In-situ', description: 'Instalamos una estación de toma de muestras en tu empresa.', icon: 'BuildingOffice' },
            { title: 'Cumplimiento Legal', description: 'Apoyo integral con los requerimientos de la NOM-035.', icon: 'ClipboardDocumentCheck' },
            { title: 'Precios Preferenciales', description: 'Paquetes corporativos ajustados al volumen de empleados.', icon: 'Tag' },
            { title: 'Reportes Epidemiológicos', description: 'Análisis estadístico del estado de salud de tu plantilla.', icon: 'ChartBar' }
        ],
        details: [
            { title: 'Checkups Ejecutivos', description: 'Evaluaciones completas para directivos y personal clave.' },
            { title: 'Exámenes de Ingreso', description: 'Validación médica para nuevos colaboradores.' },
            { title: 'Detección de Drogas', description: 'Tamizaje toxicológico multienfoque.' },
            { title: 'Campañas de Vacunación', description: 'Gestión de jornadas preventivas en el centro de trabajo.' }
        ]
    },
    {
        name: 'Tomas a Domicilio',
        description: 'La comodidad de nuestro laboratorio en tu hogar.',
        imageUrl: 'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030916/toma_kjgiit.png',
        mobileImageUrl: 'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030907/TOMA_A_DOMICILIO_aezxs9.png',
        benefits: [
            { title: 'Personal Calificado', description: 'Enfermeros expertos en toma de muestra pediátrica y geriátrica.', icon: 'UserGroup' },
            { title: 'Sin costo extra', description: 'Servicio gratuito en zonas participantes dentro de la ciudad.', icon: 'Home' },
            { title: 'Agendado Fácil', description: 'Solicita tu cita por WhatsApp o mediante nuestra web.', icon: 'CalendarDays' },
            { title: 'Seguridad Biológica', description: 'Protocolos estrictos de higiene y manejo de residuos.', icon: 'ShieldCheck' }
        ],
        details: [
            { title: 'Ideal para pacientes frágiles', description: 'Evita traslados innecesarios para adultos mayores o niños.' },
            { title: 'Mismo tiempo de entrega', description: 'El traslado no afecta la velocidad de tus resultados.' },
            { title: 'Pago al momento', description: 'Aceptamos tarjetas de crédito o efectivo en tu domicilio.' },
            { title: 'Cobertura Amplia', description: 'Servicio disponible en toda el área metropolitana.' }
        ]
    },
    {
        name: 'Laboratorio Molecular y Genética',
        description: 'Pruebas de biología molecular (PCR) y estudios genéticos, exclusivos de nuestra sucursal Guadalajara.',
        imageUrl: 'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030914/analisis_sral07.png',
        mobileImageUrl: 'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030907/ANALISIS_CLINICOS_thnzmf.png',
        benefits: [
            { title: 'Alta Sensibilidad', description: 'Detección molecular por PCR de patógenos y marcadores genéticos.', icon: 'CpuChip' },
            { title: 'Equipo Especializado', description: 'Único laboratorio molecular de la red DYRA en Jalisco.', icon: 'BeakerIcon' },
            { title: 'Asesoría Genética', description: 'Interpretación de resultados con personal capacitado.', icon: 'UserGroup' },
            { title: 'Confidencialidad', description: 'Manejo estricto de información genética sensible.', icon: 'LockClosed' }
        ],
        details: [
            { title: 'Paneles Infecciosos por PCR', description: 'Detección rápida de virus y bacterias respiratorias/gastrointestinales.' },
            { title: 'Pruebas de Paternidad', description: 'Estudios de ADN con validez informativa.' },
            { title: 'Farmacogenética', description: 'Análisis de respuesta a medicamentos según perfil genético.' },
            { title: 'Predisposición Genética', description: 'Tamizaje de riesgo hereditario para enfermedades comunes.' }
        ],
        branchNames: ['Sucursal Guadalajara']
    },
    {
        name: 'Medicina del Viajero',
        description: 'Chequeos y vacunación preventiva para viajeros, disponible en nuestra sucursal Colima.',
        imageUrl: 'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030915/salud_ubcyxb.png',
        mobileImageUrl: 'https://res.cloudinary.com/dpxcnew1i/image/upload/v1774030907/SALUD_EMPRESARIAL_nzwff6.png',
        benefits: [
            { title: 'Asesoría Personalizada', description: 'Recomendaciones según destino y tiempo de viaje.', icon: 'ClipboardDocumentCheck' },
            { title: 'Vacunación Preventiva', description: 'Esquemas de vacunación según región de destino.', icon: 'ShieldCheck' },
            { title: 'Chequeo Exprés', description: 'Perfil de salud completo antes de viajar.', icon: 'Zap' },
            { title: 'Certificados Médicos', description: 'Documentación para aerolíneas y requisitos migratorios.', icon: 'CheckBadge' }
        ],
        details: [
            { title: 'Panel Pre-viaje', description: 'Evaluación general de salud antes de salir del país.' },
            { title: 'Vacunas Internacionales', description: 'Fiebre amarilla, hepatitis y otras según destino.' },
            { title: 'Botiquín Recomendado', description: 'Orientación sobre medicamentos esenciales de viaje.' },
            { title: 'Seguimiento Post-viaje', description: 'Revisión de síntomas al regreso de zonas de riesgo.' }
        ],
        branchNames: ['Sucursal Colima']
    }
]

export const SERVICES = rawServices.map((service) => ({
    ...service,
    slug: slugify(service.name, {
        lower: true,
        strict: true,
        trim: true
    })
}))