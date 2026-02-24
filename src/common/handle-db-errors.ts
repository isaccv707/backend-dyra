import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";


export const handleDatabaseErrors = (error: any, entityName: string = 'Record') => {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
            throw new NotFoundException(`${entityName} not found`);
        }
        if (error.code === 'P2002') {
            throw new ConflictException(`There is already an ${entityName.toLocaleLowerCase()} with that unique value`);
        }
        if (error.code === 'P2003') {
            throw new BadRequestException(`Cannot delete ${entityName} because it has related records (e.g., posts)`);
        }
    }

    console.log(error);
    throw new InternalServerErrorException('Unexpected error, check server logs');
}