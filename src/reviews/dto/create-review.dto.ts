import { IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID, Max, Min, MinLength } from "class-validator";

export class CreateReviewDto {
    @IsString()
    @MinLength(3)
    fullName: string;

    @IsUUID()
    @IsNotEmpty()
    branchId: string;

    @IsInt()
    @Min(1)
    @Max(5)
    rating: number;

    @IsString()
    @IsOptional()
    comment?: string;

    @IsUrl({})
    @IsOptional()
    avatarUrl?: string;
}
