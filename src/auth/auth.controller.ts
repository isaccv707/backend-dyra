import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({
    summary: 'Iniciar sesión',
    description: 'Autentica a un usuario con email y contraseña y devuelve un token JWT.',
  })
  @ApiResponse({ status: 200, description: 'Inicio de sesión exitoso, devuelve el token de acceso.' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas.' })
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @ApiOperation({
    summary: 'Obtener usuario autenticado',
    description: 'Devuelve la información del usuario asociado al token JWT enviado en la petición.',
  })
  @ApiResponse({ status: 200, description: 'Información del usuario autenticado.' })
  @ApiResponse({ status: 401, description: 'No autenticado.' })
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: any) {
    return user;
  }

  @ApiOperation({
    summary: 'Solicitar recuperación de contraseña',
    description: 'Genera y envía un código OTP al correo del usuario para restablecer su contraseña.',
  })
  @ApiResponse({ status: 200, description: 'Código de recuperación enviado.' })
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @ApiOperation({
    summary: 'Verificar código OTP',
    description: 'Valida el código OTP enviado al correo del usuario como parte del flujo de recuperación de contraseña.',
  })
  @ApiResponse({ status: 200, description: 'Código OTP válido.' })
  @ApiResponse({ status: 400, description: 'Código OTP inválido o expirado.' })
  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @ApiOperation({
    summary: 'Restablecer contraseña',
    description: 'Establece una nueva contraseña para el usuario tras validar el código OTP.',
  })
  @ApiResponse({ status: 200, description: 'Contraseña restablecida exitosamente.' })
  @ApiResponse({ status: 400, description: 'Código OTP inválido o expirado.' })
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @ApiOperation({
    summary: 'Cambiar contraseña',
    description: 'Permite a un usuario autenticado cambiar su contraseña actual.',
  })
  @ApiResponse({ status: 200, description: 'Contraseña actualizada exitosamente.' })
  @ApiResponse({ status: 401, description: 'La contraseña actual es incorrecta.' })
  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto);
  }
}
