import { BannerPlacement } from "@prisma/client";
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, IsUUID, Min } from "class-validator";



export class CreateBannerDto {
    @IsOptional()
    @IsEnum(BannerPlacement)
    placement: BannerPlacement;

    @IsUrl()
    imageUrl: string;

    @IsOptional()
    @IsString()
    mobileImageUrl: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    order?: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsString()
    @IsOptional()
    startAt?: Date;

    @IsString()
    @IsOptional()
    endAt?: Date;

    @IsOptional()
    @IsArray()
    @IsUUID('4', { each: true })
    branchIds?: string[];
}
