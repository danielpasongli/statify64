import type { Variable } from "../../../../../types/Variable";

/** Padanan minimal variabel yang dibutuhkan untuk re-resolve. */
type VariableRef = Pick<Variable, "id" | "tempId" | "name">;

/**
 * Mencari ulang variabel terpilih dari daftar variabel terbaru (F20), karena
 * snapshot `selectedVariable` bisa basi bila kolom disisipkan/dihapus.
 * Urutan pencocokan: id → tempId → name. Mengembalikan undefined bila tidak ada.
 */
export function resolveVariable<T extends VariableRef>(
    selected: VariableRef,
    current: readonly T[]
): T | undefined {
    if (selected.id !== undefined) return current.find((v) => v.id === selected.id);
    if (selected.tempId !== undefined) return current.find((v) => v.tempId === selected.tempId);
    return current.find((v) => v.name === selected.name);
}
