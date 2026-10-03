// AGENTS.md §6.7 — katalog model bawaan Statify. KOSONG di scope ini;
// diisi pada pekerjaan terpisah.

export type BuiltinModelEntry = {
  id: string; // unik, kebab-case
  label: string; // tampilan
  description: string;
  modelType: string; // harus terdaftar di registry adapter
  path: string; // URL publik, konvensi: "/models/classify/<id>.json" (file di FE/public/models/classify/)
};

export const BUILTIN_MODELS: readonly BuiltinModelEntry[] = [];
