import { IsBoolean, IsInt, IsLowercase, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { Study } from "../entities/study.entity";
import { Type } from "class-transformer";

export class CreateStudyDto implements Partial<Study> {
    @IsString()
    @IsNotEmpty()
    @MinLength(3)
    @MaxLength(200)
    name: string;

    @IsString()
    @IsOptional()
    @IsLowercase() // Opcional: asegura que siempre sea minúsculas
    slug?: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(1)
    @MaxLength(20)
    code: string;

    @IsString()
    @MaxLength(500)
    @IsOptional()
    description?: string;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @IsPositive()
    price: number;

    @IsString()
    @MaxLength(100)
    @IsOptional()
    sampleType?: string;

    @Type(() => Number)
    @IsInt()
    @IsPositive()
    @IsOptional()
    deliveryTime?: number;

    @IsString()
    @MaxLength(500)
    @IsOptional()
    preparation?: string;

    @IsOptional()
    @IsString()
    serviceId!: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

}
