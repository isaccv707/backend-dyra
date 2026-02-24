import { BlockType } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString } from "class-validator";

export class CreateContentBlockDto {
  @IsEnum(BlockType)
  type: BlockType;

  @IsInt()
  order: number;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  src?: string;

  @IsOptional()
  @IsString()
  alt?: string;
}