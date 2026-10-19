export const PASSWORD_RESET_TOKEN_TYPE = 'password_reset';

export interface JwtPayload {
  sub: string;
  email: string;
  type?: typeof PASSWORD_RESET_TOKEN_TYPE;
}
