// quotations-interfaces.ts
export interface StudyItem {
  name: string;
  price: number;
  quantity: number;
}

export interface Totals {
  subtotal: number;
  tax: number;
  total: number;
}

export interface QuotationMeta {
  formattedDate: string;
  folio: string;
  formattedClientType: string;
  logoPath: string | null;
}

export interface ClientInfo {
  name: string;
  lastName?: string;
  phoneNumber: string;
  email: string;
  clientType: string; // ya formateado
}

export interface CompanyInfo {
  name: string;
  subtitle: string;
  address: string;
  phone: string;
  email: string;
}

export interface QuotationPdfData {
  meta: QuotationMeta;
  totals: Totals;
  client: ClientInfo;
  studies: StudyItem[];
  company: CompanyInfo;
}

export interface PdfLayout {
  pageWidth: number;
  marginLeft: number;
  marginRight: number;
}
