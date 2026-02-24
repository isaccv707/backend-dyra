import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from "class-validator";

export class CreateAuthorDto {
    @IsString()
    @MinLength(3)
    @MaxLength(80)
    name: string;
    
    @MaxLength(500)
    @IsUrl({}, { message: 'avatar must be a valid URL' })
    @IsOptional()
    avatar?: string;

    @IsOptional()
    @IsString()
    @MaxLength(600)
    bio?: string;
}