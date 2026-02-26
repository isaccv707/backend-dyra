import { Prisma, Study } from "@prisma/client";


export const STUDIES: Prisma.StudyCreateInput[] = [
    {
        name: 'Hemoglobina glicosilada',
        code: 'hba1c',
        description: 'La hemoglobina glicosilada (HbA1c) es una prueba de laboratorio...',
        price: new Prisma.Decimal(250.00), // Nota: Los campos Decimal requieren este constructor
        sampleType: 'Sangre (EDTA)',
        deliveryTime: 1,
        preparation: 'Ayuno de 8 horas.',
        isActive: true,
    },
    {
        name: 'Perfil lipídico',
        code: 'lipid_profile',
        description: 'El perfil lipídico es un conjunto de pruebas que miden los niveles de lípidos en la sangre...',
        price: new Prisma.Decimal(300.00),
        sampleType: 'Sangre (EDTA)',
        deliveryTime: 1,
        preparation: 'Ayuno de 12 horas.',
        isActive: true,
    }
]