// Forma exacta de lo que JwtStrategy.validate() adjunta a request.user
// (y, vía CurrentUser, al parámetro de los controllers/guards).
export interface RequestUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  branches: { id: string; name: string }[];
  role: {
    id: string;
    name: string;
    permissions: string[];
  };
}
