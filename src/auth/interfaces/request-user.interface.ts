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
