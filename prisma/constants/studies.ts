import { Prisma } from "@prisma/client";
import slugify from "slugify";



const rawStudies = [
    {
        name: 'Glucosa',
        code: 'GLU01',
        description: 'La hemoglobina glicosilada (HbA1c) es una prueba de laboratorio...',
        price: new Prisma.Decimal(250.00), // Nota: Los campos Decimal requieren este constructor
        sampleType: 'Sangre (EDTA)',
        deliveryTime: 1,
        preparation: 'Ayuno de 8 horas.',
        isActive: true,
        serviceId: 'ef5fe56c-bc50-47ab-b08a-02fc6e44248c'
    },
]

export const STUDIES = rawStudies.map((study) => ({
    ...study,
    slug: slugify(study.name, {
        lower: true,
        strict: true,
        trim: true
    })
}))