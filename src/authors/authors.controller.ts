import { Controller, Get, Post, Body, Query, Param, Delete, Patch, ParseUUIDPipe } from '@nestjs/common';
import { AuthorsService } from './authors.service';
import { CreateAuthorDto } from './dto/create-author.dto';
import { PaginationAuthorDto } from './dto/pagination-author.dto';
import { UpdateAuthorDto } from './dto/update-author.dto';

@Controller('authors')
export class AuthorsController {
  constructor(private readonly authorsService: AuthorsService) { }

  @Post()
  createAuthor(@Body() createAuthorDto: CreateAuthorDto) {
    return this.authorsService.createAuthor(createAuthorDto)
  }

  @Get()
  findAll(@Query() pagination: PaginationAuthorDto) {
    return this.authorsService.findAllAuthors(pagination);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.authorsService.findOneAuthor(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateAuthorDto: UpdateAuthorDto
  ) {
    return this.authorsService.updateAuthor(id, updateAuthorDto)
  }

  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.authorsService.deleteAuthor(id);
  }
}
