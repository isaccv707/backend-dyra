import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { FindEmployeesDto } from './dto/find-employees.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';

@ApiTags('employees')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @ApiOperation({ summary: 'Crear empleado', description: 'Crea un nuevo empleado en una sucursal.' })
  @ApiResponse({ status: 201, description: 'Empleado creado exitosamente.' })
  @ApiBearerAuth()
  @Permissions('employees:create')
  @Post()
  create(@Body() createEmployeeDto: CreateEmployeeDto, @CurrentUser() user: BranchScopedUser) {
    return this.employeesService.create(createEmployeeDto, user);
  }

  @ApiOperation({ summary: 'Listar empleados', description: 'Devuelve los empleados, con alcance según la sucursal del usuario autenticado.' })
  @ApiResponse({ status: 200, description: 'Listado de empleados.' })
  @ApiBearerAuth()
  @Permissions('employees:read')
  @Get()
  findAll(@Query() dto: FindEmployeesDto, @CurrentUser() user: BranchScopedUser) {
    return this.employeesService.findAll(dto, user);
  }

  @ApiOperation({ summary: 'Obtener empleado', description: 'Devuelve un empleado por su identificador.' })
  @ApiParam({ name: 'id', description: 'Identificador del empleado.' })
  @ApiResponse({ status: 200, description: 'Empleado encontrado.' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado.' })
  @ApiBearerAuth()
  @Permissions('employees:read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.employeesService.findOne(id);
  }

  @ApiOperation({ summary: 'Actualizar empleado', description: 'Actualiza los datos de un empleado existente.' })
  @ApiParam({ name: 'id', description: 'Identificador del empleado.' })
  @ApiResponse({ status: 200, description: 'Empleado actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado.' })
  @ApiBearerAuth()
  @Permissions('employees:update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.employeesService.update(id, updateEmployeeDto, user);
  }

  @ApiOperation({
    summary: 'Dar de baja empleado',
    description:
      'Libera todo el equipo asignado al empleado, cierra su resguardo vigente y lo archiva (isActive: false) ' +
      'sin eliminar su historial. Reemplaza al PATCH manual de carta responsiva: para dejar constancia de que ' +
      'el empleado firmó, use POST /safeguards/:id/sign.',
  })
  @ApiParam({ name: 'id', description: 'Identificador del empleado.' })
  @ApiResponse({ status: 200, description: 'Empleado dado de baja exitosamente.' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado.' })
  @ApiBearerAuth()
  @Permissions('employees:update')
  @Post(':id/offboard')
  offboard(@Param('id') id: string, @CurrentUser() user: BranchScopedUser & { id: string }) {
    return this.employeesService.offboard(id, user);
  }

  @ApiOperation({ summary: 'Eliminar empleado', description: 'Elimina un empleado existente. Solo aplica si nunca tuvo resguardos; use offboard en su lugar.' })
  @ApiParam({ name: 'id', description: 'Identificador del empleado.' })
  @ApiResponse({ status: 200, description: 'Empleado eliminado exitosamente.' })
  @ApiResponse({ status: 400, description: 'El empleado tiene resguardos y no se puede eliminar; use offboard.' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado.' })
  @ApiBearerAuth()
  @Permissions('employees:delete')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: BranchScopedUser) {
    return this.employeesService.remove(id, user);
  }
}
