import slugify from "slugify"


const rawServices = [
    {
        name: 'Análisis Clínicos',
        description: 'Laboratorio de alta especialidad con resultados precisos.',
        benefits: [
            { title: 'Resultados el mismo día', description: 'En el 90% de nuestras pruebas.', icon: 'Zap' },
            { title: 'Calidad Certificada', description: 'Procesos bajo estándares internacionales.', icon: 'CheckBadge' }
        ]
    },
    {
        name: 'Salud Empresarial',
        description: 'Soluciones de salud preventivas para tu csapital humano.',
        benefits: [
            { title: 'Atención In-situ', description: 'Vamos hasta tu empresa.', icon: 'BuildingOffice' },
            { title: 'Cumplimiento Legal', description: 'Apoyo con la NOM-035.', icon: 'ClipboardDocumentCheck' }
        ],
        details: [
            { title: 'Checkups Ejecutivos', description: 'Evaluaciones completas para directivos.' }
        ]
    },
    {
        name: 'Tomas a Domicilio',
        description: 'La comodidad de nuestro laboratorio en tu hogar.',
        benefits: [
            { title: 'Personal Calificado', description: 'Enfermeros expertos en toma de muestra.', icon: 'UserGroup' },
            { title: 'Sin costo extra', description: 'En zonas participantes.', icon: 'Home' }
        ]
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