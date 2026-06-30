import { IsString, IsOptional, IsArray, ValidateNested, IsInt, IsUUID, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { PostStatus, BlockType } from '@prisma/client';
import { CreateContentBlockDto } from './create-content-block.dto';

export class CreatePostDto {
    @IsString()
    title: string;

    @IsString()
    description: string;

    @IsString()
    excerpt: string;

    @IsOptional()
    @IsString()
    image?: string;

    @IsOptional()
    @IsInt()
    readingTime?: number;

    @IsOptional()
    @IsString()
    metaDescription?: string;

    @IsOptional()
    @IsEnum(PostStatus)
    status?: PostStatus;

    @IsArray()
    @IsString({ each: true })
    tags: string[];

    @IsString()
    category: string;

    @IsOptional()
    @IsUUID()
    authorId?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateContentBlockDto)
    contentBlocks: CreateContentBlockDto[];

    @IsOptional()
    @IsArray()
    @IsUUID('4', { each: true })
    branchIds?: string[];
}
