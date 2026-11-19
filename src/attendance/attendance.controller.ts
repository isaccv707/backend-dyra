import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { AttendanceService } from './attendance.service';
import {
  AttendanceRecordDto,
  AttendanceStatusDto,
  AttendanceSummaryDto,
  AttendanceUserOptionDto,
  MyAttendanceDto,
  PaginatedAttendanceRecordsDto,
} from './dto/attendance-response.dto';
import {
  AttendanceRangeDto,
  AttendanceSummaryQueryDto,
  AttendanceUsersQueryDto,
  FindAttendanceDto,
} from './dto/find-attendance.dto';
import {
  AdjustAttendanceDto,
  CreateManualAttendanceDto,
} from './dto/manual-attendance.dto';
import { PunchAttendanceDto } from './dto/punch-attendance.dto';
import { UserThrottlerGuard } from './guards/user-throttler.guard';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @ApiOperation({
    summary: 'Estado de asistencia del usuario',
    description:
      'Devuelve la siguiente checada permitida (entrada o salida), la última checada y las sucursales del usuario con su geocerca.',
  })
  @ApiResponse({ status: 200, type: AttendanceStatusDto })
  @Permissions('attendance:check')
  @Get('me/status')
  getStatus(@CurrentUser() user: RequestUser) {
    return this.attendanceService.getStatus(user);
  }

  @ApiOperation({
    summary: 'Historial propio',
    description:
      'Sesiones de trabajo (entrada/salida emparejadas) del usuario en un rango de días locales. Por defecto, los últimos 7 días; máximo 93.',
  })
  @ApiResponse({ status: 200, type: MyAttendanceDto })
  @Permissions('attendance:check')
  @Get('me')
  findMine(@Query() dto: AttendanceRangeDto, @CurrentUser() user: RequestUser) {
    return this.attendanceService.findMine(dto, user);
  }

  @ApiOperation({
    summary: 'Registrar entrada o salida',
    description:
      'Guarda la checada con la hora del servidor y la ubicación del navegador. Nunca se rechaza por ubicación: si está fuera de la geocerca, con baja precisión o con el reloj desfasado queda FLAGGED para revisión.',
  })
  @ApiResponse({ status: 201, type: AttendanceRecordDto })
  @ApiResponse({
    status: 409,
    description:
      'La checada no corresponde (entrada duplicada o salida sin entrada).',
  })
  @ApiResponse({ status: 429, description: 'Demasiadas checadas seguidas.' })
  @Permissions('attendance:check')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('punch')
  punch(
    @Body() dto: PunchAttendanceDto,
    @CurrentUser() user: RequestUser,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.attendanceService.punch(dto, user, { ipAddress, userAgent });
  }

  @ApiOperation({
    summary: 'Listar checadas',
    description:
      'Paginado y limitado a las sucursales del usuario. Filtros: sucursal, usuario, rango de días locales, estatus, tipo y origen; búsqueda por nombre de usuario.',
  })
  @ApiResponse({ status: 200, type: PaginatedAttendanceRecordsDto })
  @Permissions('attendance:read')
  @Get()
  findAll(@Query() dto: FindAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendanceService.findAll(dto, user);
  }

  @ApiOperation({
    summary: 'Resumen de asistencia',
    description:
      'Horas trabajadas por usuario y por día local, con sesiones incompletas y checadas por revisar. Máximo 93 días.',
  })
  @ApiResponse({ status: 200, type: AttendanceSummaryDto })
  @Permissions('attendance:read')
  @Get('summary')
  summary(
    @Query() dto: AttendanceSummaryQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attendanceService.summary(dto, user);
  }

  @ApiOperation({
    summary: 'Usuarios que checan',
    description:
      'Usuarios activos con attendance:check en la sucursal indicada (o en las del usuario). Para filtros y checadas manuales.',
  })
  @ApiResponse({ status: 200, type: [AttendanceUserOptionDto] })
  @Permissions('attendance:read')
  @Get('users')
  listUsers(
    @Query() dto: AttendanceUsersQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attendanceService.listUsers(dto, user);
  }

  @ApiOperation({
    summary: 'Exportar asistencia a Excel',
    description:
      'Hojas: totales por usuario, resumen por día y todas las checadas del rango.',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiResponse({ status: 200, description: 'Archivo Excel.' })
  @Permissions('attendance:export')
  @Get('export')
  async export(
    @Query() dto: AttendanceSummaryQueryDto,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.attendanceService.export(dto, user);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @ApiOperation({
    summary: 'Registrar checada manual',
    description:
      'Para olvidos: un supervisor registra la entrada o salida de otro usuario con motivo obligatorio. Sin ubicación. Debe respetar la secuencia entrada/salida.',
  })
  @ApiResponse({ status: 201, type: AttendanceRecordDto })
  @ApiResponse({ status: 403, description: 'Sucursal ajena o checada propia.' })
  @ApiResponse({ status: 409, description: 'Rompe la secuencia.' })
  @Permissions('attendance:update')
  @Post('manual')
  createManual(
    @Body() dto: CreateManualAttendanceDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attendanceService.createManual(dto, user);
  }

  @ApiOperation({
    summary: 'Revisar checada',
    description:
      'Con recordedAt corrige la hora (ADJUSTED, guarda la hora original); sin él aprueba la checada (VALID). Motivo obligatorio. No se pueden revisar checadas propias.',
  })
  @ApiParam({ name: 'id', description: 'Identificador de la checada.' })
  @ApiResponse({ status: 200, type: AttendanceRecordDto })
  @ApiResponse({ status: 404, description: 'Checada no encontrada.' })
  @ApiResponse({
    status: 409,
    description: 'La nueva hora cambia el orden de las checadas.',
  })
  @Permissions('attendance:update')
  @Patch(':id')
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustAttendanceDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attendanceService.adjust(id, dto, user);
  }
}
