import { PrismaClient } from "@prisma/client";
import { STUDIES } from "../constants/studies";


export async function seedStudies(prisma: PrismaClient) {
    for (const study of STUDIES) {
        await prisma.study.upsert({
            where: { code: study.code },
            update: {
                name: study.name,
                description: study.description,
                price: study.price,
                sampleType: study.sampleType,
                deliveryTime: study.deliveryTime,
                preparation: study.preparation,
                isActive: study.isActive
            },
            create: study
        });
    }
}