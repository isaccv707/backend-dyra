import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { PriceSheetsService } from './price-sheets.service';
import { CreatePriceSheetDto } from './dto/create-price-sheet.dto';
import { UpdatePriceSheetDto } from './dto/update-price-sheet.dto';
import { PaginationPriceSheetDto } from './dto/pagination-price-sheet.dto';

@Controller('price-sheets')
export class PriceSheetsController {
  constructor(private readonly priceSheetsService: PriceSheetsService) {}

  @Post()
  create(@Body() createPriceSheetDto: CreatePriceSheetDto) {
    return this.priceSheetsService.create(createPriceSheetDto);
  }

  @Get()
  findAll() {
    return this.priceSheetsService.findAll();
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query() paginationPriceSheetDto: PaginationPriceSheetDto,
  ) {
    return this.priceSheetsService.findOne(id, paginationPriceSheetDto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePriceSheetDto: UpdatePriceSheetDto) {
    return this.priceSheetsService.update(id, updatePriceSheetDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.priceSheetsService.remove(id);
  }
}
