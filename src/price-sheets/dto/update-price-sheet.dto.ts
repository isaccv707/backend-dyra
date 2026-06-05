import { PartialType } from '@nestjs/mapped-types';
import { CreatePriceSheetDto } from './create-price-sheet.dto';

export class UpdatePriceSheetDto extends PartialType(CreatePriceSheetDto) {}
