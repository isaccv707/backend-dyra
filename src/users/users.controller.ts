import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginatedQueryDto } from '../common/dto/paginated-query.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Permissions('users:create')
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Permissions('users:read')
  @Post('query')
  @HttpCode(200)
  findAllPaginated(@Body() dto: PaginatedQueryDto) {
    return this.usersService.findAllPaginated(dto);
  }

  @Permissions('users:read')
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Permissions('users:read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Permissions('users:update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Permissions('users:delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
