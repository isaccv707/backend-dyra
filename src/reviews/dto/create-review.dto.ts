import { IsInt, IsOptional, IsString, IsUrl, Max, Min, MinLength } from "class-validator";

export class CreateReviewDto {
    @IsString()
    @MinLength(3, { message: 'The name must be at least 3 characters long' })
    fullName: string;

    @IsInt()
    @Min(1, { message: 'La calificación mínima es 1' })
    @Max(5, { message: 'La calificación máxima es 5' })
    rating: number;

    @IsString()
    @IsOptional()
    comment?: string;

    @IsUrl({}, { message: 'El avatar debe ser una URL válida' })
    @IsOptional()
    avatarUrl?: string;
}
