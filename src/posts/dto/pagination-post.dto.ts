import { PostStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsPositive, IsString, IsUUID, Min } from "class-validator";


export class PaginationPostDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    @Type(() => Number)
    page?: number = 1;

    @IsOptional()
    @IsInt()
    @IsPositive()
    @Type(() => Number)
    limit?: number = 10;

    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsEnum(PostStatus)
    status?: PostStatus;

    @IsOptional()
    @IsString()
    category?: string;

    @IsOptional()
    @IsString()
    tag?: string;

    @IsOptional()
    @IsUUID()
    branchId?: string;
}