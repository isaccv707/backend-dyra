import { Type } from "class-transformer";
import { IsInt, IsNumber, IsOptional, Max, Min } from "class-validator";

export class PaginationDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @IsOptional()
    page?: number = 1;

    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @IsOptional()
    @Max(30)
    limit?: number = 10;
}