import { PostStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString, IsUUID } from "class-validator";
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class PaginationPostDto extends PaginatedQueryDto {
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