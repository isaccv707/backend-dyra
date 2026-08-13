import { Type } from "class-transformer";
import { IsArray, IsEmail, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, ValidateNested } from "class-validator";


export class SelectedStudyDto {
    @IsOptional()
    @IsUUID()
    id?: string;
    @IsString()
    @IsNotEmpty()
    name: string;
    @IsNumber()
    @Type(() => Number)
    price: number;
    @IsNumber()
    @Type(() => Number)
    @IsPositive()
    quantity: number;
}


export class CreateQuotationDto {
    // @IsString()
    // @IsOptional()
    // id: string;

    @IsString()
    @IsNotEmpty()
    clientType: string

    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsOptional()
    lastName: string;

    @IsString()
    @IsNotEmpty()
    phoneNumber: string;

    // @IsEmail()
    @IsOptional()
    email: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SelectedStudyDto)
    studies: SelectedStudyDto[];

    @IsUUID()
    branchId: string;

    @IsUUID()
    priceSheetId: string;
}
