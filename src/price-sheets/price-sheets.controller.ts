import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { PriceSheetsService } from './price-sheets.service';
import { CreatePriceSheetDto } from './dto/create-price-sheet.dto';
import { UpdatePriceSheetDto } from './dto/update-price-sheet.dto';
import { PaginationPriceSheetDto } from './dto/pagination-price-sheet.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('price-sheets')
export class PriceSheetsController {
  constructor(private readonly priceSheetsService: PriceSheetsService) {}

  @Permissions('price-sheets:create')
  @Post()
  create(@Body() createPriceSheetDto: CreatePriceSheetDto) {
    return this.priceSheetsService.create(createPriceSheetDto);
  }

  @Public()
  @Get()
  findAll() {
    return this.priceSheetsService.findAll();
  }

  @Public()
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query() paginationPriceSheetDto: PaginationPriceSheetDto,
  ) {
    return this.priceSheetsService.findOne(id, paginationPriceSheetDto);
  }

  @Permissions('price-sheets:update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePriceSheetDto: UpdatePriceSheetDto) {
    return this.priceSheetsService.update(id, updatePriceSheetDto);
  }

  @Permissions('price-sheets:delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.priceSheetsService.remove(id);
  }
}
